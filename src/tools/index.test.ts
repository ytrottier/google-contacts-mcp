import {
	describe, it, expect, vi, afterEach,
} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../index.js';

async function listToolNames(): Promise<string[]> {
	const server = createServer({token: 'test-token'});
	const client = new Client({name: 'test', version: '1.0.0'});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return (await client.listTools()).tools.map((tool) => tool.name);
}

const DELETE_TOOLS = ['contact_delete', 'contact_photo_delete', 'contact_group_delete'];

describe('DISABLE_DELETE_TOOLS', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('registers the delete tools by default', async () => {
		vi.stubEnv('DISABLE_DELETE_TOOLS', '');
		expect(await listToolNames()).toEqual(expect.arrayContaining(DELETE_TOOLS));
	});

	it.each(['1', 'true'])('leaves out the delete tools when set to %s', async (value) => {
		vi.stubEnv('DISABLE_DELETE_TOOLS', value);
		const names = await listToolNames();
		for (const tool of DELETE_TOOLS) {
			expect(names).not.toContain(tool);
		}

		expect(names).toContain('contact_update');
		expect(names).toContain('contact_group_members_modify');
	});
});
