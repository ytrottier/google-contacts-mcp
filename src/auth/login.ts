import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {GOOGLE_TOKEN_ENDPOINT, writeStoredToken} from './refresh-token.js';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Opens a URL in the default browser. Failures are ignored, since the URL is also printed. */
export function openInBrowser(url: string): void {
	const isWindows = process.platform === 'win32';
	// On Windows, `start` is a cmd builtin. Quoting the URL stops cmd from treating & as a command separator.
	const [command, args] = isWindows
		? ['cmd', ['/c', 'start', '""', `"${url}"`]]
		: [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
	const child = spawn(command, args, {stdio: 'ignore', detached: true, windowsVerbatimArguments: isWindows});
	child.on('error', () => {
		// Ignore: the user can open the printed URL themselves
	});
	child.unref();
}

type LoginOptions = {
	clientId: string;
	clientSecret: string;
	scopes: string[];
	tokenFile: string;
	openBrowser?: (url: string) => void;
	log?: (message: string) => void;
};

/**
 * One-time sign-in using Google's installed-app loopback flow with PKCE.
 * Saves the resulting refresh token to tokenFile.
 */
export async function login({
	clientId, clientSecret, scopes, tokenFile, openBrowser = openInBrowser, log = console.error,
}: LoginOptions): Promise<void> {
	const codeVerifier = randomBytes(32).toString('base64url');
	const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
	const state = randomBytes(16).toString('base64url');

	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	try {
		const code = await new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('Timed out waiting for Google sign-in.'));
			}, LOGIN_TIMEOUT_MS);

			server.on('request', (req, res) => {
				const url = new URL(req.url ?? '/', redirectUri);
				if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
					res.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'}).end('Unexpected request.');
					return;
				}

				const error = url.searchParams.get('error');
				const authCode = url.searchParams.get('code');
				if (error || !authCode) {
					res.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'}).end(`Sign-in failed: ${error ?? 'no code returned'}. You can close this tab.`);
					clearTimeout(timeout);
					reject(new Error(`Google sign-in failed: ${error ?? 'no code returned'}`));
					return;
				}

				res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'}).end('Signed in to google-contacts-mcp. You can close this tab.');
				clearTimeout(timeout);
				resolve(authCode);
			});

			const authUrl = `${GOOGLE_AUTH_ENDPOINT}?${new URLSearchParams({
				client_id: clientId,
				redirect_uri: redirectUri,
				response_type: 'code',
				scope: scopes.join(' '),
				access_type: 'offline',
				prompt: 'consent',
				state,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256',
			}).toString()}`;
			log(`Opening your browser to sign in to Google. If it does not open, visit this URL:\n\n${authUrl}\n`);
			openBrowser(authUrl);
		});

		const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
			method: 'POST',
			headers: {'Content-Type': 'application/x-www-form-urlencoded'},
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				code,
				code_verifier: codeVerifier,
				redirect_uri: redirectUri,
				grant_type: 'authorization_code',
			}).toString(),
		});
		const data = await response.json().catch(() => ({})) as {refresh_token?: string; scope?: string; error?: string; error_description?: string};
		if (!response.ok) {
			throw new Error(`Google token exchange failed: ${response.status} ${data.error ?? ''} ${data.error_description ?? ''}`.trim());
		}

		if (!data.refresh_token) {
			throw new Error('Google did not return a refresh token. Remove the app\'s access at https://myaccount.google.com/permissions and run auth again.');
		}

		writeStoredToken(tokenFile, {refresh_token: data.refresh_token, ...(data.scope && {scope: data.scope}), created_at: new Date().toISOString()});
		log(`Signed in. Saved Google sign-in to ${tokenFile}`);
	} finally {
		server.closeAllConnections();
		server.close();
	}
}
