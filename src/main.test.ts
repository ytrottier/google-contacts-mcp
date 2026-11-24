import {
	describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

const listen = vi.fn(() => ({on: vi.fn()}));

vi.mock('express', () => {
	const app = {
		use: vi.fn(), get: vi.fn(), post: vi.fn(), all: vi.fn(), listen,
	};
	const express = Object.assign(() => app, {json: vi.fn(), urlencoded: vi.fn()});
	return {default: express};
});

describe('HTTP transport', () => {
	beforeEach(() => {
		vi.resetModules();
		listen.mockClear();
		vi.stubEnv('MCP_TRANSPORT', 'http');
		vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
		vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
		vi.stubEnv('PORT', '4321');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('listens on loopback only by default', async () => {
		vi.stubEnv('HOST', '');
		await import('./main.js');
		await vi.waitFor(() => {
			expect(listen).toHaveBeenCalledWith(4321, '127.0.0.1', expect.any(Function));
		});
	});

	it('listens on the host given in HOST', async () => {
		vi.stubEnv('HOST', '0.0.0.0');
		await import('./main.js');
		await vi.waitFor(() => {
			expect(listen).toHaveBeenCalledWith(4321, '0.0.0.0', expect.any(Function));
		});
	});

	async function advertisedScopes(): Promise<string[]> {
		await import('./main.js');
		const express = (await import('express')).default as unknown as () => {get: ReturnType<typeof vi.fn>};
		const app = express();
		await vi.waitFor(() => {
			expect(listen).toHaveBeenCalled();
		});
		const route = app.get.mock.calls.findLast(([path]) => path === '/.well-known/oauth-authorization-server') as [string, (req: unknown, res: {json: (body: {scopes_supported: string[]}) => void}) => void];
		let scopes: string[] = [];
		route[1]({}, {
			json(body) {
				scopes = body.scopes_supported;
			},
		});
		return scopes;
	}

	it('does not ask for Google Drive access by default', async () => {
		vi.stubEnv('ENABLE_DRIVE_PHOTOS', '');
		expect(await advertisedScopes()).toEqual([
			'https://www.googleapis.com/auth/contacts',
			'https://www.googleapis.com/auth/directory.readonly',
			'https://www.googleapis.com/auth/contacts.other.readonly',
		]);
	});

	it('asks for read-only Google Drive access when Drive photos are enabled', async () => {
		vi.stubEnv('ENABLE_DRIVE_PHOTOS', '1');
		expect(await advertisedScopes()).toContain('https://www.googleapis.com/auth/drive.readonly');
	});
});
