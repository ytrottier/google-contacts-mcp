import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Config} from './types.js';

import {registerContactsList} from './contacts-list.js';
import {registerContactGet} from './contact-get.js';
import {registerContactSearch} from './contact-search.js';
import {registerContactCreate} from './contact-create.js';
import {registerContactUpdate} from './contact-update.js';
import {registerContactDelete} from './contact-delete.js';
import {registerContactPhotoUpdate} from './contact-photo-update.js';
import {registerContactPhotoDelete} from './contact-photo-delete.js';
import {registerContactPhotoUpdateFromFile} from './contact-photo-update-from-file.js';
import {registerContactPhotoUpdateFromDrive} from './contact-photo-update-from-drive.js';
import {isDrivePhotosEnabled} from '../utils/drive-api.js';
import {registerDirectorySearch} from './directory-search.js';
import {registerContactGroupsList} from './contact-groups-list.js';
import {registerContactGroupGet} from './contact-group-get.js';
import {registerContactGroupCreate} from './contact-group-create.js';
import {registerContactGroupUpdate} from './contact-group-update.js';
import {registerContactGroupDelete} from './contact-group-delete.js';
import {registerContactGroupMembersModify} from './contact-group-members-modify.js';
import {registerOtherContactsList} from './other-contacts-list.js';
import {registerOtherContactsSearch} from './other-contacts-search.js';
import {registerOtherContactCopyToContacts} from './other-contact-copy-to-contacts.js';

export type {Config} from './types.js';

export function registerAll(server: McpServer, config: Config): void {
	registerContactsList(server, config);
	registerContactGet(server, config);
	registerContactSearch(server, config);
	registerContactCreate(server, config);
	registerContactUpdate(server, config);
	registerContactPhotoUpdate(server, config);
	registerDirectorySearch(server, config);
	registerContactGroupsList(server, config);
	registerContactGroupGet(server, config);
	registerContactGroupCreate(server, config);
	registerContactGroupUpdate(server, config);
	registerContactGroupMembersModify(server, config);
	registerOtherContactsList(server, config);
	registerOtherContactsSearch(server, config);
	registerOtherContactCopyToContacts(server, config);

	// Optional: lets clients pass a file path instead of base64 bytes for photos
	// PHOTO_DIR is the earlier name of PHOTO_ROOT
	const photoRoot = process.env.PHOTO_ROOT || process.env.PHOTO_DIR;
	if (photoRoot) {
		registerContactPhotoUpdateFromFile(server, config, photoRoot);
	}

	// Optional, and off by default because it needs read access to the user's Google Drive
	if (isDrivePhotosEnabled()) {
		registerContactPhotoUpdateFromDrive(server, config);
	}

	// The People API has no trash, so allow running without the tools that permanently delete data
	if (!['1', 'true'].includes(process.env.DISABLE_DELETE_TOOLS?.toLowerCase() ?? '')) {
		registerContactDelete(server, config);
		registerContactPhotoDelete(server, config);
		registerContactGroupDelete(server, config);
	}
}
