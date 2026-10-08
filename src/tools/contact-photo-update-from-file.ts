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

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const inputSchema = strictSchemaWithAliases({
	resourceName: z.string().describe('The resource name of the contact (e.g., "people/c12345")'),
	path: z.string().describe('Path of a JPEG or PNG file inside the photo folder, relative to it (e.g. "jane-doe.jpg") or absolute'),
}, {});

function isJpegOrPng(bytes: Buffer): boolean {
	const isJpeg = bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
	const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
	return isJpeg || isPng;
}

/** Reads a photo, refusing anything that does not resolve (after following symlinks) to a file inside photoDir */
export async function readPhotoFromDir(photoDir: string, path: string): Promise<Buffer> {
	const dir = await realpath(photoDir);
	let target: string;
	try {
		target = await realpath(resolve(dir, path));
	} catch {
		throw new Error(`Photo not found: ${path}`);
	}

	const relativePath = relative(dir, target);
	if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error(`Photo must be inside the photo folder (${dir}): ${path}`);
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

export function registerContactPhotoUpdateFromFile(server: McpServer, config: Config, photoDir: string): void {
	server.registerTool(
		'contact_photo_update_from_file',
		{
			title: 'Update contact photo from file',
			description: `Set (or replace) the photo for a contact from a JPEG or PNG file (max 5 MB) in the photo folder (${photoDir}). Prefer this over contact_photo_update when the image is saved on disk.`,
			inputSchema,
			outputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			},
		},
		async ({resourceName, path}) => {
			const bytes = await readPhotoFromDir(photoDir, path);
			const result = await makePeopleApiCall('PATCH', `/${resourceName}:updateContactPhoto`, config.token, {photoBytes: bytes.toString('base64')});
			return jsonResult(outputSchema.parse(result));
		},
	);
}
