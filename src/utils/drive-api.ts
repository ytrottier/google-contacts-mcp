// Google Drive API helpers, used only when Drive photos are enabled

import type {TokenProvider} from './contacts-api.js';

export const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Drive photos are off unless ENABLE_DRIVE_PHOTOS is set, so the server only asks for Drive access when explicitly configured to */
export function isDrivePhotosEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return ['1', 'true'].includes(env.ENABLE_DRIVE_PHOTOS?.toLowerCase() ?? '');
}

/** Quotes a value for use in a Drive search query */
export function driveQueryString(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

async function checkResponse(response: Response): Promise<Response> {
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Drive API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	return response;
}

/** GET from the Drive API, refreshing the token and retrying once on a 401 when a token provider is used */
export async function driveGet(endpoint: string, accessToken: string | TokenProvider): Promise<Response> {
	const url = `${DRIVE_API_BASE_URL}${endpoint}`;
	const send = async (token: string) => fetch(url, {method: 'GET', headers: {Authorization: `Bearer ${token}`}});

	if (typeof accessToken === 'string') {
		return checkResponse(await send(accessToken));
	}

	let response = await send(await accessToken());
	if (response.status === 401) {
		response = await send(await accessToken({forceRefresh: true}));
	}

	return checkResponse(response);
}
