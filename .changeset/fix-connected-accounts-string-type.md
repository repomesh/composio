---
'@composio/core': patch
---

Fix `connectedAccounts` TypeScript type so a single `string` per toolkit is actually accepted by the public API.

Previously the schema's `.transform()` made `ToolRouterCreateSessionConfig['connectedAccounts']` resolve to `Record<string, string[]>` (the post-transform output), so TypeScript users still got `Type 'string' is not assignable to type 'string[]'` even though the runtime accepted strings. Coercion now happens inside `ToolRouter.create`, mirroring the Python implementation, and the public type is `Record<string, string | string[]>`.
