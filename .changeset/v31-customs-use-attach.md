---
'@composio/core': minor
---

Add custom tools support to `composio.use()`.

- **`composio.use(id, { customTools, customToolkits })`**: Attach to an existing session through the v3.1 attach endpoint. When custom tools are provided, binds local tools for search and execution; when called without custom tools, it still uses attach with an empty body so session reuse has one backend path.
- **Inline custom tools payload**: `use()` now correctly passes `inlineCustomToolsPayload` and `preloadedCustomToolSlugs` to the session, enabling custom tool execution and preloading on rehydrated sessions.
- **`CustomToolsMap.tools`**: The map now caches the raw `CustomTool[]` array for future inline re-injection on v3.1 search/execute requests.
