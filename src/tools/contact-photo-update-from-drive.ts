import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Config} from './types.js';
import {makePeopleApiCall} from '../utils/contacts-api.js';
import {driveGet, driveQueryString} from '../utils/drive-api.js';
import {jsonResult} from '../utils/response.js';
import {strictSchemaWithAliases} from '../utils/schema.js';
import {outputSchema} from './contact-photo-update.js';
import {MAX_PHOTO_BYTES, isJpegOrPng} from './contact-photo-update-from-file.js';

const inputSchema = strictSchemaWithAliases({
	resourceName: z.string().describe('The resource name of the contact (e.g., "people/c12345")'),
	folder: z.string().describe('The name of the Google Drive folder that holds the photo, as the user named it (e.g. "Headshots"). If the user did not say which folder, ask them rather than guessing.'),
	fileName: z.string().describe('The photo\'s file name inside that folder (e.g. "jane-doe.jpg")'),
}, {});

type DriveFile = {
	id: string;
	name?: string;
	size?: string;
	parents?: string[];
};

const LIST_OPTIONS = 'supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=10';

async function listFiles(query: string, config: Config): Promise<DriveFile[]> {
	const params = new URLSearchParams({q: query, fields: 'files(id,name,size,parents)'});
	const response = await driveGet(`/files?${params.toString()}&${LIST_OPTIONS}`, config.token);
	const data = await response.json() as {files?: DriveFile[]};
	return data.files ?? [];
}

async function parentName(file: DriveFile, config: Config): Promise<string> {
	const parentId = file.parents?.[0];
	if (!parentId) {
		return 'shared with you';
	}

	try {
		const response = await driveGet(`/files/${encodeURIComponent(parentId)}?fields=name&supportsAllDrives=true`, config.token);
		const data = await response.json() as {name?: string};
		return `in "${data.name ?? parentId}"`;
	} catch {
		return 'in a folder you cannot see';
	}
}

/** Downloads a photo from a Drive folder found by name, refusing anything that is not a single JPEG or PNG of at most 5 MB */
export async function readPhotoFromDrive(folder: string, fileName: string, config: Config): Promise<Buffer> {
	const folders = await listFiles(`name = ${driveQueryString(folder)} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, config);
	if (folders.length === 0) {
		throw new Error(`No Google Drive folder named "${folder}" was found`);
	}

	if (folders.length > 1) {
		const places = await Promise.all(folders.slice(0, 5).map(async (f) => parentName(f, config)));
		throw new Error(`Several Google Drive folders are named "${folder}" (${places.join('; ')}). Ask the user which one they mean, or to rename one.`);
	}

	const [{id: folderId}] = folders as [DriveFile];
	const files = await listFiles(`${driveQueryString(folderId)} in parents and name = ${driveQueryString(fileName)} and trashed = false`, config);
	if (files.length === 0) {
		throw new Error(`No file named "${fileName}" in the Google Drive folder "${folder}"`);
	}

	if (files.length > 1) {
		throw new Error(`Several files are named "${fileName}" in the Google Drive folder "${folder}"`);
	}

	const [file] = files as [DriveFile];
	if (file.size !== undefined && Number(file.size) > MAX_PHOTO_BYTES) {
		throw new Error(`Photo is too large (${file.size} bytes, max ${MAX_PHOTO_BYTES}): ${folder}/${fileName}`);
	}

	const response = await driveGet(`/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, config.token);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length > MAX_PHOTO_BYTES) {
		throw new Error(`Photo is too large (${bytes.length} bytes, max ${MAX_PHOTO_BYTES}): ${folder}/${fileName}`);
	}

	if (!isJpegOrPng(bytes)) {
		throw new Error(`Photo must be a JPEG or PNG image: ${folder}/${fileName}`);
	}

	return bytes;
}

export function registerContactPhotoUpdateFromDrive(server: McpServer, config: Config): void {
	server.registerTool(
		'contact_photo_update_from_drive',
		{
			title: 'Update contact photo from Google Drive',
			description: 'Set (or replace) the photo for a contact from a JPEG or PNG file (max 5 MB) in a Google Drive folder named by the user. Prefer this over contact_photo_update when the image is in Google Drive. Returns the updated contact with its new photo URL and etag.',
			inputSchema,
			outputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			},
		},
		async ({resourceName, folder, fileName}) => {
			const bytes = await readPhotoFromDrive(folder, fileName, config);
			const result = await makePeopleApiCall('PATCH', `/${resourceName}:updateContactPhoto`, config.token, {
				photoBytes: bytes.toString('base64'),
				// Without personFields, Google returns an empty response
				personFields: 'photos',
			});
			return jsonResult(outputSchema.parse(result));
		},
	);
}
