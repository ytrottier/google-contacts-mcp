// Google People API configuration and utilities

export const PEOPLE_API_BASE_URL = 'https://people.googleapis.com/v1';

/** Returns a valid access token. forceRefresh asks for a new one, e.g. after the API rejected the previous one. */
export type TokenProvider = (options?: {forceRefresh?: boolean}) => Promise<string>;

// Common helper to create base headers
function createBaseHeaders(accessToken: string): Record<string, string> {
	return {
		Authorization: `Bearer ${accessToken}`,
		Accept: 'application/json',
	};
}

// Common helper to handle API errors
async function handleApiError(response: Response): Promise<never> {
	const errorText = await response.text();
	throw new Error(`People API error: ${response.status} ${response.statusText} - ${errorText}`);
}

// Common helper to parse response based on content type
async function parseResponse(response: Response): Promise<unknown> {
	if (!response.ok) {
		await handleApiError(response);
	}

	const contentType = response.headers.get('content-type');

	if (contentType?.includes('application/json')) {
		const responseText = await response.text();

		if (!responseText.trim()) {
			return {success: true, message: 'Operation completed successfully'};
		}

		try {
			return JSON.parse(responseText);
		} catch (error) {
			throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return (await response.text()) || 'Success';
}

// Utility function to make authenticated API calls
export async function makePeopleApiCall(
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
	endpoint: string,
	accessToken: string | TokenProvider,
	body?: unknown,
) {
	const url = `${PEOPLE_API_BASE_URL}${endpoint}`;

	const send = async (token: string) => {
		const headers = createBaseHeaders(token);

		if (body) {
			headers['Content-Type'] = 'application/json';
		}

		const fetchOptions: RequestInit = {
			method,
			headers,
		};

		if (body) {
			fetchOptions.body = JSON.stringify(body);
		}

		return fetch(url, fetchOptions);
	};

	if (typeof accessToken === 'string') {
		return parseResponse(await send(accessToken));
	}

	let response = await send(await accessToken());
	if (response.status === 401) {
		// The access token may have been revoked or expired early: refresh it and retry once
		response = await send(await accessToken({forceRefresh: true}));
	}

	return parseResponse(response);
}
