import {z} from 'zod';

type AliasMap = Record<string, string>;

/**
 * Creates a strict Zod object schema that rejects any unknown parameters.
 *
 * Parameter aliases (e.g. new_string -> new_str) are not supported with Zod 4: wrapping the object in a preprocess
 * step hides its shape from the MCP SDK, which would then advertise the tool with no inputs. No tool uses aliases.
 */
export function strictSchemaWithAliases<T extends z.ZodRawShape>(
	shape: T,
	aliases: AliasMap = {},
): z.ZodObject<T, z.core.$strict> {
	if (Object.keys(aliases).length > 0) {
		throw new Error('strictSchemaWithAliases: parameter aliases are not supported');
	}

	return z.strictObject(shape);
}
