import {
	mkdirSync, mkdtempSync, symlinkSync, writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../index.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('rest-of-png')]);
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('rest-of-jpeg')]);

async function connect() {
	const server = createServer({token: 'test-token'});
	const client = new Client({name: 'test', version: '1.0.0'});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

async function callTool(path: string) {
	const client = await connect();
	return client.callTool({name: 'contact_photo_update_from_file', arguments: {resourceName: 'people/c1', path}});
}

function errorText(result: Awaited<ReturnType<typeof callTool>>): string {
	expect(result.isError).toBe(true);
	return JSON.stringify(result.content);
}

describe('contact_photo_update_from_file', () => {
	let root: string;
	let photoDir: string;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gcm-photos-'));
		photoDir = join(root, 'photos');
		mkdirSync(photoDir);
		writeFileSync(join(root, 'secret.png'), PNG);
		vi.stubEnv('PHOTO_DIR', photoDir);
		fetchMock = vi.fn(async () => new Response(JSON.stringify({person: {resourceName: 'people/c1', etag: 'etag-2'}}), {status: 200, headers: {'content-type': 'application/json'}}));
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('uploads a PNG from the photo folder', async () => {
		writeFileSync(join(photoDir, 'jane.png'), PNG);

		const result = await callTool('jane.png');

		expect(result.isError).toBeFalsy();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://people.googleapis.com/v1/people/c1:updateContactPhoto');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body as string)).toEqual({photoBytes: PNG.toString('base64'), personFields: 'photos'});
		expect(result.structuredContent).toEqual({person: {resourceName: 'people/c1', etag: 'etag-2'}});
	});

	it('accepts a JPEG by absolute path inside the folder, whatever its extension', async () => {
		writeFileSync(join(photoDir, 'portrait.bin'), JPEG);

		const result = await callTool(join(photoDir, 'portrait.bin'));

		expect(result.isError).toBeFalsy();
		expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({photoBytes: JPEG.toString('base64'), personFields: 'photos'});
	});

	it('rejects path traversal out of the folder', async () => {
		expect(errorText(await callTool('../secret.png'))).toContain('inside the photo folder');
		expect(errorText(await callTool('..\\secret.png'))).toMatch(/inside the photo folder|not found/);
		expect(errorText(await callTool(join(root, 'secret.png')))).toContain('inside the photo folder');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.skipIf(process.platform === 'win32')('rejects symlinks that point outside the folder', async () => {
		symlinkSync(join(root, 'secret.png'), join(photoDir, 'link.png'));

		expect(errorText(await callTool('link.png'))).toContain('inside the photo folder');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects files that are not JPEG or PNG, regardless of extension', async () => {
		writeFileSync(join(photoDir, 'fake.jpg'), 'definitely not an image');

		expect(errorText(await callTool('fake.jpg'))).toContain('JPEG or PNG');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects files over 5 MB', async () => {
		writeFileSync(join(photoDir, 'huge.png'), Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));

		expect(errorText(await callTool('huge.png'))).toContain('too large');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('allows file names that merely start with two dots', async () => {
		writeFileSync(join(photoDir, '..jane.png'), PNG);

		expect((await callTool('..jane.png')).isError).toBeFalsy();
	});

	it('rejects the folder itself and missing files', async () => {
		expect(errorText(await callTool('.'))).toContain('inside the photo folder');
		expect(errorText(await callTool('missing.png'))).toContain('not found');
	});

	it('is only available when PHOTO_DIR is set', async () => {
		expect((await (await connect()).listTools()).tools.map((t) => t.name)).toContain('contact_photo_update_from_file');

		vi.stubEnv('PHOTO_DIR', '');
		expect((await (await connect()).listTools()).tools.map((t) => t.name)).not.toContain('contact_photo_update_from_file');
	});
});
