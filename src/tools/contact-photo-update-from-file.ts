import {open, realpath} from 'node:fs/promises';
import {
	isAbsolute, relative, resolve, sep,
} from 'node:path';
import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Config} from './types.js';
import {makePeopleApiCall} from '../utils/contacts-api.js';
import {jsonResult} from '../utils/response.js';
import {strictSchemaWithAliases} from '../utils/schema.js';
import {outputSchema} from './contact-photo-update.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const inputSchema = strictSchemaWithAliases({
	resourceName: z.string().describe('The resource name of the contact (e.g., "people/c12345")'),
	folder: z.string().describe('The subfolder of the user\'s photo folder that holds the photo, as the user named it (e.g. "Headshots"); "." for the photo folder itself. If the user did not say which folder, ask them rather than guessing.'),
	fileName: z.string().describe('The photo\'s file name inside that folder (e.g. "jane-doe.jpg")'),
}, {});

export function isJpegOrPng(bytes: Buffer): boolean {
	const isJpeg = bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
	const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
	return isJpeg || isPng;
}

function isInside(dir: string, target: string): boolean {
	const relativePath = relative(dir, target);
	return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

/** Reads a photo from a subfolder of photoRoot, refusing anything that does not resolve (after following symlinks) to a file inside photoRoot */
export async function readPhotoFromRoot(photoRoot: string, folder: string, fileName: string): Promise<Buffer> {
	const path = `${folder}/${fileName}`;
	if (!fileName || fileName === '.' || fileName === '..' || /[/\\]/.test(fileName)) {
		throw new Error(`File name must be a plain file name, without folders: ${fileName}`);
	}

	if (isAbsolute(folder)) {
		throw new Error(`Folder must be a subfolder of the photo folder, not a full path: ${folder}`);
	}

	const root = await realpath(photoRoot);
	let dir: string;
	let target: string;
	try {
		dir = await realpath(resolve(root, folder));
	} catch {
		throw new Error(`Folder not found in the photo folder: ${folder}`);
	}

	if (!isInside(root, dir)) {
		throw new Error(`Folder must be inside the photo folder (${root}): ${folder}`);
	}

	try {
		target = await realpath(resolve(dir, fileName));
	} catch {
		throw new Error(`Photo not found: ${path}`);
	}

	if (target === root || !isInside(root, target)) {
		throw new Error(`Photo must be inside the photo folder (${root}): ${path}`);
	}

	const file = await open(target, 'r');
	try {
		const stats = await file.stat();
		if (!stats.isFile()) {
			throw new Error(`Not a file: ${path}`);
		}

		if (stats.size > MAX_PHOTO_BYTES) {
			throw new Error(`Photo is too large (${stats.size} bytes, max ${MAX_PHOTO_BYTES}): ${path}`);
		}

		const bytes = await file.readFile();
		if (!isJpegOrPng(bytes)) {
			throw new Error(`Photo must be a JPEG or PNG image: ${path}`);
		}

		return bytes;
	} finally {
		await file.close();
	}
}

export function registerContactPhotoUpdateFromFile(server: McpServer, config: Config, photoRoot: string): void {
	server.registerTool(
		'contact_photo_update_from_file',
		{
			title: 'Update contact photo from file',
			description: `Set (or replace) the photo for a contact from a JPEG or PNG file (max 5 MB) in a subfolder, named by the user, of the photo folder (${photoRoot}). Prefer this over contact_photo_update when the image is saved on disk. Returns the updated contact with its new photo URL and etag.`,
			inputSchema,
			outputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			},
		},
		async ({resourceName, folder, fileName}) => {
			const bytes = await readPhotoFromRoot(photoRoot, folder, fileName);
			const result = await makePeopleApiCall('PATCH', `/${resourceName}:updateContactPhoto`, config.token, {
				photoBytes: bytes.toString('base64'),
				// Without personFields, Google returns an empty response
				personFields: 'photos',
			});
			return jsonResult(outputSchema.parse(result));
		},
	);
}
