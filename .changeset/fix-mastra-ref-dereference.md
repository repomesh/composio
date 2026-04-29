---
'@composio/core': patch
'@composio/mastra': patch
---

Resolve internal JSON Schema `$ref` pointers (`#/$defs/...` and `#/definitions/...`) before handing tool parameters to `@mastra/schema-compat`. Composio tools whose schemas use `$defs`/`definitions` — legal under Draft 7 and 2020-12 — no longer trigger the AJV `can't resolve reference …` error, and the resolved type information from `$defs` survives the JSON-Schema → Zod → JSON-Schema round-trip instead of being silently degraded to a permissive `anyOf`.

- New `dereferenceJsonSchema` helper exported from `@composio/core` performs the inline expansion. It deep-clones the input, walks every applicator reflectively (so future JSON Schema keywords are covered), shallow-merges sibling keywords next to `$ref` per Draft 2020-12 semantics, breaks cycles with `{ type: 'object', additionalProperties: true }` (matching the upstream guidance in [mastra-ai/mastra#15341](https://github.com/mastra-ai/mastra/issues/15341)), and strips `$defs`/`definitions` once everything reachable is inlined. External (`http://`/`https://`) `$ref` pointers are left untouched.
- `@composio/mastra` calls the helper inside `wrapTool` for both `inputParameters` and `outputParameters`.
- `@mastra/schema-compat` dependency floor raised to `^1.2.9` so users automatically receive [PR #15400](https://github.com/mastra-ai/mastra/pull/15400)'s recursive-`$ref` handling.

Closes [PLEN-2244](https://linear.app/composio/issue/PLEN-2244/mastra-provider-schema-validation-error-cant-resolve-reference).
