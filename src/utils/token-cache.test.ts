import {
	describe, it, expect, vi, afterEach,
} from 'vitest';
import {isTokenValid} from './token-cache.js';

function tokeninfo(body: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

// Each test uses its own token, because results are cached per token
let counter = 0;
function newToken(): string {
	counter += 1;
	return `token-${counter}`;
}

describe('isTokenValid', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('accepts a valid token issued to this app', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => tokeninfo({aud: 'our-client', azp: 'our-client', expires_in: '3599'})));

		expect(await isTokenValid(newToken(), 'our-client')).toBe(true);
	});

	it('accepts a token whose authorized party is this app', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => tokeninfo({aud: 'something-else', azp: 'our-client', expires_in: 3599})));

		expect(await isTokenValid(newToken(), 'our-client')).toBe(true);
	});

	it('rejects a valid token issued to another app, and does not check it again', async () => {
		const fetchMock = vi.fn(async () => tokeninfo({aud: 'other-app', azp: 'other-app', expires_in: '3599'}));
		vi.stubGlobal('fetch', fetchMock);
		const token = newToken();

		expect(await isTokenValid(token, 'our-client')).toBe(false);
		expect(await isTokenValid(token, 'our-client')).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not check the app when no client is expected', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => tokeninfo({aud: 'other-app', expires_in: '3599'})));

		expect(await isTokenValid(newToken())).toBe(true);
	});

	it('rejects invalid and expired tokens', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => tokeninfo({error_description: 'Invalid Value'}, 400)));
		expect(await isTokenValid(newToken(), 'our-client')).toBe(false);

		vi.stubGlobal('fetch', vi.fn(async () => tokeninfo({aud: 'our-client', expires_in: '0'})));
		expect(await isTokenValid(newToken(), 'our-client')).toBe(false);
	});
});
