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

async function callTool(folder: string, fileName: string) {
	const client = await connect();
	return client.callTool({name: 'contact_photo_update_from_file', arguments: {resourceName: 'people/c1', folder, fileName}});
}

function errorText(result: Awaited<ReturnType<typeof callTool>>): string {
	expect(result.isError).toBe(true);
	return JSON.stringify(result.content);
}

describe('contact_photo_update_from_file', () => {
	let root: string;
	let photoRoot: string;
	let headshots: string;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gcm-photos-'));
		photoRoot = join(root, 'photos');
		headshots = join(photoRoot, 'Headshots');
		mkdirSync(headshots, {recursive: true});
		writeFileSync(join(root, 'secret.png'), PNG);
		mkdirSync(join(root, 'outside'));
		writeFileSync(join(root, 'outside', 'secret.png'), PNG);
		vi.stubEnv('PHOTO_DIR', '');
		vi.stubEnv('PHOTO_ROOT', photoRoot);
		fetchMock = vi.fn(async () => new Response(JSON.stringify({person: {resourceName: 'people/c1', etag: 'etag-2'}}), {status: 200, headers: {'content-type': 'application/json'}}));
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('uploads a PNG from the named subfolder', async () => {
		writeFileSync(join(headshots, 'jane.png'), PNG);

		const result = await callTool('Headshots', 'jane.png');

		expect(result.isError).toBeFalsy();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://people.googleapis.com/v1/people/c1:updateContactPhoto');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body as string)).toEqual({photoBytes: PNG.toString('base64'), personFields: 'photos'});
		expect(result.structuredContent).toEqual({person: {resourceName: 'people/c1', etag: 'etag-2'}});
	});

	it('accepts "." for the photo folder itself, and JPEGs whatever their extension', async () => {
		writeFileSync(join(photoRoot, 'portrait.bin'), JPEG);

		const result = await callTool('.', 'portrait.bin');

		expect(result.isError).toBeFalsy();
		expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({photoBytes: JPEG.toString('base64'), personFields: 'photos'});
	});

	it('accepts nested subfolders inside the photo folder', async () => {
		mkdirSync(join(headshots, '2026'));
		writeFileSync(join(headshots, '2026', 'jane.png'), PNG);

		expect((await callTool('Headshots/2026', 'jane.png')).isError).toBeFalsy();
	});

	it('rejects folders that leave the photo folder', async () => {
		expect(errorText(await callTool('..', 'secret.png'))).toContain('inside the photo folder');
		expect(errorText(await callTool('../outside', 'secret.png'))).toContain('inside the photo folder');
		expect(errorText(await callTool('Headshots/../../outside', 'secret.png'))).toContain('inside the photo folder');
		expect(errorText(await callTool(join(root, 'outside'), 'secret.png'))).toContain('not a full path');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects file names that contain folders', async () => {
		expect(errorText(await callTool('Headshots', '../../secret.png'))).toContain('plain file name');
		expect(errorText(await callTool('.', '..\\secret.png'))).toContain('plain file name');
		expect(errorText(await callTool('Headshots', '..'))).toContain('plain file name');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.skipIf(process.platform === 'win32')('rejects symlinked folders and files that point outside the photo folder', async () => {
		symlinkSync(join(root, 'outside'), join(photoRoot, 'Linked'));
		symlinkSync(join(root, 'secret.png'), join(headshots, 'link.png'));

		expect(errorText(await callTool('Linked', 'secret.png'))).toContain('inside the photo folder');
		expect(errorText(await callTool('Headshots', 'link.png'))).toContain('inside the photo folder');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('explains when the folder or the photo does not exist', async () => {
		expect(errorText(await callTool('Missing', 'jane.png'))).toContain('Folder not found');
		expect(errorText(await callTool('Headshots', 'missing.png'))).toContain('Photo not found');
	});

	it('rejects files that are not JPEG or PNG, regardless of extension', async () => {
		writeFileSync(join(headshots, 'fake.jpg'), 'definitely not an image');

		expect(errorText(await callTool('Headshots', 'fake.jpg'))).toContain('JPEG or PNG');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects files over 5 MB', async () => {
		writeFileSync(join(headshots, 'huge.png'), Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));

		expect(errorText(await callTool('Headshots', 'huge.png'))).toContain('too large');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('allows file names that merely start with two dots', async () => {
		writeFileSync(join(headshots, '..jane.png'), PNG);

		expect((await callTool('Headshots', '..jane.png')).isError).toBeFalsy();
	});

	it('still accepts the earlier PHOTO_DIR setting', async () => {
		vi.stubEnv('PHOTO_ROOT', '');
		vi.stubEnv('PHOTO_DIR', photoRoot);
		writeFileSync(join(headshots, 'jane.png'), PNG);

		expect((await callTool('Headshots', 'jane.png')).isError).toBeFalsy();
	});

	it('is only available when a photo folder is set', async () => {
		expect((await (await connect()).listTools()).tools.map((t) => t.name)).toContain('contact_photo_update_from_file');

		vi.stubEnv('PHOTO_ROOT', '');
		expect((await (await connect()).listTools()).tools.map((t) => t.name)).not.toContain('contact_photo_update_from_file');
	});
});
