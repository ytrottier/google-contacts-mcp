import {
	describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../index.js';

async function connect() {
	const server = createServer({token: 'test-token'});
	const client = new Client({name: 'test', version: '1.0.0'});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

// Required inputs per tool. Every tool must advertise these, so the client knows how to call it.
const REQUIRED_INPUTS: Record<string, string[]> = {
	contacts_list: [],
	contact_get: ['resourceName'],
	contact_search: ['query'],
	contact_create: [],
	contact_update: ['resourceName', 'etag'],
	contact_delete: ['resourceName'],
	contact_photo_update: ['resourceName', 'photoBytes'],
	contact_photo_update_from_file: ['resourceName', 'folder', 'fileName'],
	contact_photo_update_from_drive: ['resourceName', 'folder', 'fileName'],
	contact_photo_delete: ['resourceName'],
	directory_search: ['query'],
	contact_groups_list: [],
	contact_group_get: ['resourceName'],
	contact_group_create: ['name'],
	contact_group_update: ['resourceName', 'etag', 'name'],
	contact_group_delete: ['resourceName'],
	contact_group_members_modify: ['resourceName'],
	other_contacts_list: [],
	other_contacts_search: ['query'],
	other_contact_copy_to_contacts: ['resourceName'],
};

describe('tool input schemas', () => {
	beforeEach(() => {
		// Register every optional tool too
		vi.stubEnv('PHOTO_ROOT', '/tmp');
		vi.stubEnv('ENABLE_DRIVE_PHOTOS', '1');
		vi.stubEnv('DISABLE_DELETE_TOOLS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('every tool advertises its inputs, with the required ones marked, and refuses unknown ones', async () => {
		const {tools} = await (await connect()).listTools();

		expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(REQUIRED_INPUTS).sort());
		for (const tool of tools) {
			const schema = tool.inputSchema as {properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown};
			expect(Object.keys(schema.properties ?? {}).length, `${tool.name} lists no inputs`).toBeGreaterThan(0);
			expect([...schema.required ?? []].sort(), `${tool.name} required inputs`).toEqual([...REQUIRED_INPUTS[tool.name]!].sort());
			expect(schema.additionalProperties, `${tool.name} accepts unknown inputs`).toBe(false);
		}
	});

	it('rejects unknown arguments when a tool is called', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const result = await (await connect()).callTool({name: 'contact_get', arguments: {resourceName: 'people/c1', notARealOption: true}});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain('notARealOption');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects tool calls with an excessive number of input elements before validating them', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const emailAddresses = Array.from({length: 20_000}, () => ({value: 1}));
		const result = await (await connect()).callTool({name: 'contact_create', arguments: {emailAddresses}});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain('more than the maximum');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
