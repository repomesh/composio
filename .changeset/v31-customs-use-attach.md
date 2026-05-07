---
'@composio/core': minor
---

Add custom tools support to `composio.use()`.

- **`composio.use(id, { customTools, customToolkits })`**: Reuse an existing session and optionally bind SDK-local custom tools for search and execution.
- **Inline custom tools payload**: `use()` now correctly passes `inlineCustomToolsPayload` and `preloadedCustomToolSlugs` to the session, enabling custom tool execution and preloading on rehydrated sessions.
- **`CustomToolsMap.tools`**: The map now caches the raw `CustomTool[]` array for future inline re-injection on v3.1 search/execute requests.
