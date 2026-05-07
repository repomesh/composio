---
'@composio/core': minor
---

Update `connectedAccounts` from `Record<string, string>` to `Record<string, string[]>`.

Matches the v3.1 API where each toolkit maps to an array of connected account IDs. Only one account per toolkit is allowed when multi-account mode is disabled. Bumps `@composio/client` to `0.1.0-alpha.70`.
