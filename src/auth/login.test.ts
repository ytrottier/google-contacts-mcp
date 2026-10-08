import {mkdtempSync} from 'node:fs';
import {request} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	describe, it, expect, vi, afterEach,
} from 'vitest';
import {login} from './login.js';
import {readStoredToken} from './refresh-token.js';

// Simulates the browser being redirected back to the loopback server by Google
function fakeBrowser(params: (authUrl: URL) => Record<string, string>) {
	return (url: string) => {
		const authUrl = new URL(url);
		const redirect = new URL(authUrl.searchParams.get('redirect_uri')!);
		for (const [key, value] of Object.entries(params(authUrl))) {
			redirect.searchParams.set(key, value);
		}

		request(redirect, (res) => res.resume()).end();
	};
}

describe('login', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('runs the loopback flow with PKCE and saves the refresh token', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token: 'a', refresh_token: 'refresh-xyz', scope: 'https://www.googleapis.com/auth/contacts'}), {status: 200}));
		vi.stubGlobal('fetch', fetchMock);
		const tokenFile = join(mkdtempSync(join(tmpdir(), 'gcm-login-')), 'token.json');
		let authUrl: URL | undefined;

		await login({
			clientId: 'client-id',
			clientSecret: 'client-secret',
			scopes: ['https://www.googleapis.com/auth/contacts'],
			tokenFile,
			log() {/* quiet */},
			openBrowser: fakeBrowser((url) => {
				authUrl = url;
				return {code: 'auth-code', state: url.searchParams.get('state')!};
			}),
		});

		expect(`${authUrl!.origin}${authUrl!.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(authUrl?.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(authUrl?.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authUrl?.searchParams.get('access_type')).toBe('offline');

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://oauth2.googleapis.com/token');
		const body = Object.fromEntries(new URLSearchParams(init.body as string));
		expect(body).toMatchObject({
			client_id: 'client-id',
			client_secret: 'client-secret',
			code: 'auth-code',
			grant_type: 'authorization_code',
			redirect_uri: authUrl?.searchParams.get('redirect_uri'),
		});
		expect(body.code_verifier).toMatch(/^[\w-]{43}$/);
		expect(readStoredToken(tokenFile)).toMatchObject({refresh_token: 'refresh-xyz'});
	});

	it('fails when Google reports an error', async () => {
		vi.stubGlobal('fetch', vi.fn());
		const tokenFile = join(mkdtempSync(join(tmpdir(), 'gcm-login-')), 'token.json');

		await expect(login({
			clientId: 'client-id',
			clientSecret: 'client-secret',
			scopes: [],
			tokenFile,
			log() {/* quiet */},
			openBrowser: fakeBrowser((url) => ({error: 'access_denied', state: url.searchParams.get('state')!})),
		})).rejects.toThrow(/access_denied/);
		expect(readStoredToken(tokenFile)).toBeUndefined();
	});
});
