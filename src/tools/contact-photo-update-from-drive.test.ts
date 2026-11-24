import {
	describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../index.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('rest-of-png')]);

type Route = (url: URL) => Response | undefined;

function json(data: unknown): Response {
	return new Response(JSON.stringify(data), {status: 200, headers: {'content-type': 'application/json'}});
}

async function connect() {
	const server = createServer({token: 'test-token'});
	const client = new Client({name: 'test', version: '1.0.0'});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

async function callTool(folder: string, fileName: string) {
	const client = await connect();
	return client.callTool({name: 'contact_photo_update_from_drive', arguments: {resourceName: 'people/c1', folder, fileName}});
}

function errorText(result: Awaited<ReturnType<typeof callTool>>): string {
	expect(result.isError).toBe(true);
	return JSON.stringify(result.content);
}

describe('contact_photo_update_from_drive', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let routes: Route[];

	// Answers Drive and People API requests from the routes set by each test
	function stubFetch() {
		fetchMock = vi.fn(async (input: string) => {
			const url = new URL(input);
			for (const route of routes) {
				const response = route(url);
				if (response) {
					return response;
				}
			}

			throw new Error(`Unexpected request: ${input}`);
		});
		vi.stubGlobal('fetch', fetchMock);
	}

	const folderSearch = (folders: unknown[]): Route => (url) => (url.pathname === '/drive/v3/files' && url.searchParams.get('q')?.includes('mimeType = \'application/vnd.google-apps.folder\'') ? json({files: folders}) : undefined);
	const fileSearch = (files: unknown[]): Route => (url) => (url.pathname === '/drive/v3/files' && url.searchParams.get('q')?.includes('in parents') ? json({files}) : undefined);
	const download = (bytes: Buffer): Route => (url) => (url.pathname === '/drive/v3/files/file-1' && url.searchParams.get('alt') === 'media' ? new Response(bytes, {status: 200}) : undefined);
	const people: Route = (url) => (url.hostname === 'people.googleapis.com' ? json({person: {resourceName: 'people/c1', etag: 'etag-2'}}) : undefined);

	beforeEach(() => {
		vi.stubEnv('ENABLE_DRIVE_PHOTOS', '1');
		routes = [];
		stubFetch();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('finds the folder and file by name, downloads it and sets the photo', async () => {
		routes = [folderSearch([{id: 'folder-1', name: 'Headshots'}]), fileSearch([{id: 'file-1', name: 'jane.png', size: String(PNG.length)}]), download(PNG), people];

		const result = await callTool('Headshots', 'jane.png');

		expect(result.isError).toBeFalsy();
		const urls = fetchMock.mock.calls.map(([u]) => new URL(u as string));
		expect(urls).toHaveLength(4);
		expect(urls[0]!.searchParams.get('q')).toBe('name = \'Headshots\' and mimeType = \'application/vnd.google-apps.folder\' and trashed = false');
		expect(urls[1]!.searchParams.get('q')).toBe('\'folder-1\' in parents and name = \'jane.png\' and trashed = false');
		expect(urls[2]!.pathname).toBe('/drive/v3/files/file-1');
		expect(urls[3]!.href).toBe('https://people.googleapis.com/v1/people/c1:updateContactPhoto');
		const [, init] = fetchMock.mock.calls[3] as [string, RequestInit];
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body as string)).toEqual({photoBytes: PNG.toString('base64'), personFields: 'photos'});
		expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).toEqual({Authorization: 'Bearer test-token'});
		expect(result.structuredContent).toEqual({person: {resourceName: 'people/c1', etag: 'etag-2'}});
	});

	it('escapes quotes in folder and file names', async () => {
		routes = [folderSearch([{id: 'folder-1'}]), fileSearch([{id: 'file-1'}]), download(PNG), people];

		await callTool('Yannick\'s photos', 'o\'brien.png');

		const urls = fetchMock.mock.calls.map(([u]) => new URL(u as string));
		expect(urls[0]!.searchParams.get('q')).toContain('name = \'Yannick\\\'s photos\'');
		expect(urls[1]!.searchParams.get('q')).toContain('name = \'o\\\'brien.png\'');
	});

	it('explains when no folder has that name', async () => {
		routes = [folderSearch([])];

		expect(errorText(await callTool('Headshots', 'jane.png'))).toContain('No Google Drive folder named');
	});

	it('asks which folder is meant when several share the name', async () => {
		routes = [
			folderSearch([{id: 'a', parents: ['p1']}, {id: 'b', parents: ['p2']}]),
			(url) => (url.pathname === '/drive/v3/files/p1' ? json({name: 'Work'}) : undefined),
			(url) => (url.pathname === '/drive/v3/files/p2' ? json({name: 'Personal'}) : undefined),
		];

		const text = errorText(await callTool('Headshots', 'jane.png'));
		expect(text).toContain('Several Google Drive folders');
		expect(text).toContain('Work');
		expect(text).toContain('Personal');
	});

	it('explains when the file is not in the folder', async () => {
		routes = [folderSearch([{id: 'folder-1'}]), fileSearch([])];

		expect(errorText(await callTool('Headshots', 'jane.png'))).toContain('No file named');
	});

	it('rejects files that are not JPEG or PNG', async () => {
		routes = [folderSearch([{id: 'folder-1'}]), fileSearch([{id: 'file-1', size: '20'}]), download(Buffer.from('not an image at all'))];

		expect(errorText(await callTool('Headshots', 'fake.jpg'))).toContain('JPEG or PNG');
		expect(fetchMock.mock.calls.some(([u]) => String(u).includes('people.googleapis.com'))).toBe(false);
	});

	it('rejects files over 5 MB without downloading them', async () => {
		routes = [folderSearch([{id: 'folder-1'}]), fileSearch([{id: 'file-1', size: String((5 * 1024 * 1024) + 1)}])];

		expect(errorText(await callTool('Headshots', 'huge.png'))).toContain('too large');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('is only available when ENABLE_DRIVE_PHOTOS is set', async () => {
		expect((await (await connect()).listTools()).tools.map((t) => t.name)).toContain('contact_photo_update_from_drive');

		vi.stubEnv('ENABLE_DRIVE_PHOTOS', '');
		expect((await (await connect()).listTools()).tools.map((t) => t.name)).not.toContain('contact_photo_update_from_drive');
	});
});
