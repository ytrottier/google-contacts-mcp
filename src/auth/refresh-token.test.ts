import {
	mkdtempSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	describe, it, expect, vi, afterEach,
} from 'vitest';
import {
	createRefreshTokenProvider, getTokenFilePath, readStoredToken, writeStoredToken,
} from './refresh-token.js';
import {makePeopleApiCall} from '../utils/contacts-api.js';

function tokenResponse(accessToken: string, expiresIn = 3599): Response {
	return new Response(JSON.stringify({access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer'}), {status: 200, headers: {'content-type': 'application/json'}});
}

function tempTokenFile(): string {
	const file = join(mkdtempSync(join(tmpdir(), 'gcm-token-')), 'nested', 'token.json');
	writeStoredToken(file, {refresh_token: 'refresh-1'});
	return file;
}

describe('token file', () => {
	it('uses %APPDATA% on Windows, ~/.config elsewhere, and GOOGLE_CONTACTS_TOKEN_FILE if set', () => {
		expect(getTokenFilePath({APPDATA: 'C:\\Users\\y\\AppData\\Roaming'}, 'win32')).toBe(join('C:\\Users\\y\\AppData\\Roaming', 'google-contacts-mcp', 'token.json'));
		expect(getTokenFilePath({}, 'linux')).toMatch(/\.config[/\\]google-contacts-mcp[/\\]token\.json$/);
		expect(getTokenFilePath({GOOGLE_CONTACTS_TOKEN_FILE: '/custom/token.json'}, 'win32')).toBe('/custom/token.json');
	});

	it('round-trips the refresh token and is only readable by the owner', () => {
		const file = tempTokenFile();
		expect(readStoredToken(file)).toEqual({refresh_token: 'refresh-1'});
		if (process.platform !== 'win32') {
			expect((statSync(file).mode % 0o1000).toString(8)).toBe('600');
		}
	});

	it('returns undefined when there is no saved sign-in', () => {
		expect(readStoredToken(join(tmpdir(), 'does-not-exist', 'token.json'))).toBeUndefined();
	});

	it('explains how to recover from a corrupt token file', () => {
		const file = tempTokenFile();
		writeFileSync(file, 'not json');
		expect(() => readStoredToken(file)).toThrow(/npm run auth/);
	});
});

describe('createRefreshTokenProvider', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('exchanges the refresh token and caches the access token until shortly before expiry', async () => {
		vi.useFakeTimers({toFake: ['Date']});
		const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse('access-1')).mockResolvedValueOnce(tokenResponse('access-2'));
		vi.stubGlobal('fetch', fetchMock);
		const provider = createRefreshTokenProvider({clientId: 'id', clientSecret: 'secret', tokenFile: tempTokenFile()});

		expect(await provider()).toBe('access-1');
		expect(await provider()).toBe('access-1');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://oauth2.googleapis.com/token');
		expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
			client_id: 'id', client_secret: 'secret', refresh_token: 'refresh-1', grant_type: 'refresh_token',
		});

		// Within a minute of expiry, refresh again
		vi.setSystemTime(Date.now() + ((3599 - 30) * 1000));
		expect(await provider()).toBe('access-2');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('tells the user to sign in again when the refresh token was revoked', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({error: 'invalid_grant', error_description: 'Token has been expired or revoked.'}), {status: 400})));
		const provider = createRefreshTokenProvider({clientId: 'id', clientSecret: 'secret', tokenFile: tempTokenFile()});

		await expect(provider()).rejects.toThrow(/expired or been revoked.*npm run auth/);
	});

	it('tells the user to sign in when the token file is missing', async () => {
		const provider = createRefreshTokenProvider({clientId: 'id', clientSecret: 'secret', tokenFile: join(tmpdir(), 'missing', 'token.json')});

		await expect(provider()).rejects.toThrow(/No saved Google sign-in.*npm run auth/);
	});

	it('refreshes and retries once when the People API returns 401', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(tokenResponse('stale'))
			.mockResolvedValueOnce(new Response('{"error":{"code":401}}', {status: 401, headers: {'content-type': 'application/json'}}))
			.mockResolvedValueOnce(tokenResponse('fresh'))
			.mockResolvedValueOnce(new Response('{"resourceName":"people/c1"}', {status: 200, headers: {'content-type': 'application/json'}}));
		vi.stubGlobal('fetch', fetchMock);
		const provider = createRefreshTokenProvider({clientId: 'id', clientSecret: 'secret', tokenFile: tempTokenFile()});

		const result = await makePeopleApiCall('GET', '/people/c1', provider);

		expect(result).toEqual({resourceName: 'people/c1'});
		const authHeaders = fetchMock.mock.calls
			.filter(([url]) => String(url).startsWith('https://people.googleapis.com'))
			.map(([, init]) => (init as RequestInit & {headers: Record<string, string>}).headers.Authorization);
		expect(authHeaders).toEqual(['Bearer stale', 'Bearer fresh']);
	});

	it('still passes a plain access token straight through', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"code":401}}', {status: 401, headers: {'content-type': 'application/json'}}));
		vi.stubGlobal('fetch', fetchMock);

		await expect(makePeopleApiCall('GET', '/people/c1', 'static-token')).rejects.toThrow(/401/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('writeStoredToken', () => {
	it('writes JSON', () => {
		const file = tempTokenFile();
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({refresh_token: 'refresh-1'});
	});
});
