import { z } from 'zod/v3';
import { JsonSchemaRefResolutionError, JsonSchemaToZodError } from '../errors';
import { jsonSchemaToZod } from '@composio/json-schema-to-zod';

const MAX_REF_CHAIN_DEPTH = 100;
const MAX_NODE_DEPTH = 512;
const CYCLE_BREAK_SENTINEL = Object.freeze({ type: 'object', additionalProperties: true });
const INTERNAL_REF_PREFIX = '#';

const decodePointerSegment = (segment: string): string =>
  segment.replace(/~1/g, '/').replace(/~0/g, '~');

const resolvePointer = (
  root: Record<string, unknown>,
  pointer: string
): { target: unknown; canonical: string } => {
  if (pointer === '#' || pointer === '') {
    return { target: root, canonical: '#' };
  }
  if (!pointer.startsWith('#/')) {
    throw new JsonSchemaRefResolutionError(`Unsupported $ref pointer: ${pointer}`, {
      meta: { ref: pointer },
    });
  }
  const segments = pointer.slice(2).split('/').map(decodePointerSegment);
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') {
      throw new JsonSchemaRefResolutionError(`Cannot resolve $ref ${pointer}`, {
        meta: { ref: pointer, failedAt: segment },
      });
    }
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        throw new JsonSchemaRefResolutionError(`Cannot resolve $ref ${pointer}`, {
          meta: { ref: pointer, failedAt: segment },
        });
      }
      cursor = cursor[index];
    } else {
      const obj = cursor as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(obj, segment)) {
        throw new JsonSchemaRefResolutionError(`Cannot resolve $ref ${pointer}`, {
          meta: { ref: pointer, failedAt: segment },
        });
      }
      cursor = obj[segment];
    }
  }
  return { target: cursor, canonical: pointer };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Inlines internal JSON Schema `$ref` pointers (`#/$defs/...` and the
 * legacy `#/definitions/...`) so the returned schema can be safely handed
 * to consumers — like AJV in `@mastra/schema-compat` — that don't tolerate
 * unresolved references.
 *
 * The traversal is reflective (no allow-list of JSON Schema keywords), so
 * future applicators (`unevaluatedProperties`, `dependentSchemas`, …) are
 * covered automatically. Sibling keywords next to `$ref` are shallow-merged
 * per Draft 2020-12 semantics — the sibling wins on collision so a caller's
 * `description` or `default` overrides the target's. Recursive `$ref`
 * chains are broken with `{ type: 'object', additionalProperties: true }`,
 * matching the upstream Mastra recommendation in
 * {@link https://github.com/mastra-ai/mastra/issues/15341 mastra-ai/mastra#15341}.
 *
 * The input schema is not mutated: every node is deep-cloned. `$defs` and
 * `definitions` are stripped from the returned root once everything
 * reachable is inlined — AJV strict-mode otherwise complains about unused
 * definitions.
 *
 * External `$ref` pointers (`http://`, `https://`, `file://`, …) are left
 * untouched: the caller may forward them to a consumer that resolves them
 * natively.
 *
 * @param schema - The JSON Schema to dereference. May be any plain object.
 * @returns A new schema with internal `$ref` pointers inlined.
 *
 * @throws {JsonSchemaRefResolutionError} When an internal pointer is
 * malformed, points at a missing target, or chains past the depth cap.
 *
 * @example
 * ```ts
 * dereferenceJsonSchema({
 *   type: 'object',
 *   properties: { user: { $ref: '#/$defs/User' } },
 *   $defs: { User: { type: 'object', properties: { id: { type: 'string' } } } },
 * });
 * // {
 * //   type: 'object',
 * //   properties: {
 * //     user: { type: 'object', properties: { id: { type: 'string' } } },
 * //   },
 * // }
 * ```
 */
export function dereferenceJsonSchema<T = unknown>(schema: T): T {
  if (!isPlainObject(schema)) return schema;

  const root = schema as Record<string, unknown>;
  const visiting = new WeakSet<object>();

  const walk = (node: unknown, path: string[], depth: number, nodeDepth: number): unknown => {
    if (nodeDepth >= MAX_NODE_DEPTH) {
      throw new JsonSchemaRefResolutionError(
        `JSON Schema node depth exceeded cap (${MAX_NODE_DEPTH})`
      );
    }
    if (Array.isArray(node)) {
      if (visiting.has(node)) return { ...CYCLE_BREAK_SENTINEL };
      visiting.add(node);
      try {
        return node.map((item, index) =>
          walk(item, [...path, String(index)], depth, nodeDepth + 1)
        );
      } finally {
        visiting.delete(node);
      }
    }
    if (!isPlainObject(node)) return node;
    if (visiting.has(node)) return { ...CYCLE_BREAK_SENTINEL };
    visiting.add(node);
    try {
      if (typeof node.$ref === 'string') {
        const ref = node.$ref;
        // External refs are out of scope; leave them alone.
        if (!ref.startsWith(INTERNAL_REF_PREFIX)) {
          const cloned: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(node)) {
            cloned[key] = walk(value, [...path, key], depth, nodeDepth + 1);
          }
          return cloned;
        }

        if (depth >= MAX_REF_CHAIN_DEPTH) {
          throw new JsonSchemaRefResolutionError(
            `JSON Schema $ref chain exceeded depth cap (${MAX_REF_CHAIN_DEPTH}): ${ref}`,
            { meta: { ref } }
          );
        }

        // Cycle detection: if `ref` already appears in the current path, this
        // resolution would re-enter itself. Break the cycle.
        if (path.includes(`@ref:${ref}`)) {
          return { ...CYCLE_BREAK_SENTINEL };
        }

        const { target } = resolvePointer(root, ref);
        const resolved = walk(target, [...path, `@ref:${ref}`], depth + 1, nodeDepth + 1);

        // Shallow-merge sibling keywords (Draft 2020-12 semantics: siblings win
        // on collision). Draft 7 ignores siblings entirely, but the Composio
        // tool surface admits both drafts so we honor siblings for safety.
        const { $ref: _omit, ...siblings } = node;
        void _omit;
        if (Object.keys(siblings).length === 0) {
          return resolved;
        }
        if (!isPlainObject(resolved)) {
          return resolved;
        }
        const merged: Record<string, unknown> = { ...resolved };
        for (const [key, value] of Object.entries(siblings)) {
          merged[key] = walk(value, [...path, key], depth, nodeDepth + 1);
        }
        return merged;
      }

      const cloned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        cloned[key] = walk(value, [...path, key], depth, nodeDepth + 1);
      }
      return cloned;
    } finally {
      visiting.delete(node);
    }
  };

  const out = walk(root, [], 0, 0);
  if (isPlainObject(out)) {
    delete out.$defs;
    delete out.definitions;
  }
  return out as T;
}

/**
 * Removes all non-required properties from the schema
 *
 * if no items are required, the schema is returned as is
 * @param schema - The JSON schema to remove non-required properties from
 * @returns The JSON schema with all non-required properties removed
 */
export const removeNonRequiredProperties = <
  T extends {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  },
>(
  schema: T
): T => {
  if (schema && schema.type === 'object' && (schema.required as string[])?.length) {
    schema.properties = Object.fromEntries(
      Object.entries(schema.properties || {}).filter(([key]) =>
        (schema.required as string[]).includes(key)
      )
    );
  }
  // In strict mode, we don't allow additional properties
  schema.additionalProperties = false;
  return schema as T;
};

/**
 * Convert a JSON schema to a Zod schema
 * @param jsonSchema - The JSON schema to convert
 * @param strict - Eliminates all non-required properties from the schema
 * @returns The Zod schema
 *
 * @throws {JsonSchemaToZodError} If the JSON schema is invalid
 *
 * @example
 * ```ts
 * const zodSchema = jsonSchemaToZodSchema({
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string' },
 *   },
 * });
 *
 * console.log(zodSchema);
 * ```
 *
 * @example
 * ```ts
 * const zodSchema = jsonSchemaToZodSchema({
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string' },
 *     age: { type: 'number' },
 *   },
 *   required: ['name'],
 * }, { strict: true });
 *
 * console.log(zodSchema);
 *
 * // Output:
 * // z.object({
 * //   name: z.string(),
 * // })
 * ```
 */
export function jsonSchemaToZodSchema<T extends z.ZodTypeAny>(
  jsonSchema: Record<string, unknown>,
  { strict }: { strict?: boolean } = {
    strict: false,
  }
): T {
  try {
    let schema = jsonSchema;
    // Remove all non-required properties from the schema if strict is true
    if (strict && schema) {
      schema = removeNonRequiredProperties(
        schema as {
          type: 'object';
          properties: Record<string, unknown>;
          required?: string[] | undefined;
        }
      );
    }
    // Convert the JSON schema properties to Zod schema
    const zodSchema = jsonSchemaToZod(schema) as T;
    return zodSchema;
  } catch (error) {
    throw new JsonSchemaToZodError('Failed to convert JSON Schema to Zod Schema', {
      cause: error,
    });
  }
}
