import {
	chmodSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import type {TokenProvider} from '../utils/contacts-api.js';

export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Refresh this long before Google's stated expiry, to allow for clock skew and request time
const EXPIRY_MARGIN_MS = 60 * 1000;

export type StoredToken = {
	refresh_token: string;
	scope?: string;
	created_at?: string;
};

export const REAUTH_HINT = 'Run `npm run auth` (or `node dist/main.js auth`) in the google-contacts-mcp folder to sign in again.';

/** Per-user location of the saved refresh token, overridable with GOOGLE_CONTACTS_TOKEN_FILE */
export function getTokenFilePath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
	if (env.GOOGLE_CONTACTS_TOKEN_FILE) {
		return env.GOOGLE_CONTACTS_TOKEN_FILE;
	}

	if (platform === 'win32' && env.APPDATA) {
		return join(env.APPDATA, 'google-contacts-mcp', 'token.json');
	}

	return join(homedir(), '.config', 'google-contacts-mcp', 'token.json');
}

export function readStoredToken(path: string): StoredToken | undefined {
	let contents: string;
	try {
		contents = readFileSync(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}

		throw error;
	}

	let parsed: Partial<StoredToken>;
	try {
		parsed = JSON.parse(contents) as Partial<StoredToken>;
	} catch {
		throw new Error(`Saved Google sign-in at ${path} is not valid JSON. ${REAUTH_HINT}`);
	}

	if (typeof parsed?.refresh_token !== 'string' || !parsed.refresh_token) {
		throw new Error(`Saved Google sign-in at ${path} has no refresh token. ${REAUTH_HINT}`);
	}

	return parsed as StoredToken;
}

export function writeStoredToken(path: string, token: StoredToken): void {
	mkdirSync(dirname(path), {recursive: true, mode: 0o700});
	writeFileSync(path, `${JSON.stringify(token, null, 2)}\n`, {mode: 0o600});
	// writeFileSync only applies mode to new files; tighten an existing one too (no-op on Windows)
	chmodSync(path, 0o600);
}

/** Exchanges the saved refresh token for access tokens, caching each until shortly before it expires */
export function createRefreshTokenProvider({clientId, clientSecret, tokenFile}: {clientId: string; clientSecret: string; tokenFile: string}): TokenProvider {
	let cached: {accessToken: string; expiresAt: number} | undefined;
	let pending: Promise<string> | undefined;

	const refresh = async (): Promise<string> => {
		const stored = readStoredToken(tokenFile);
		if (!stored) {
			throw new Error(`No saved Google sign-in found at ${tokenFile}. ${REAUTH_HINT}`);
		}

		const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
			method: 'POST',
			headers: {'Content-Type': 'application/x-www-form-urlencoded'},
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: stored.refresh_token,
				grant_type: 'refresh_token',
			}).toString(),
		});
		const data = await response.json().catch(() => ({})) as {access_token?: string; expires_in?: number; error?: string; error_description?: string};

		if (!response.ok || !data.access_token) {
			if (data.error === 'invalid_grant') {
				throw new Error(`The saved Google sign-in has expired or been revoked. ${REAUTH_HINT}`);
			}

			throw new Error(`Failed to refresh Google access token: ${response.status} ${data.error ?? ''} ${data.error_description ?? ''}`.trim());
		}

		cached = {accessToken: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 3600) * 1000) - EXPIRY_MARGIN_MS};
		return data.access_token;
	};

	return async ({forceRefresh = false} = {}) => {
		if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
			return cached.accessToken;
		}

		pending ??= refresh().finally(() => {
			pending = undefined;
		});
		return pending;
	};
}
