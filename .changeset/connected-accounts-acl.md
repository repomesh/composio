---
'@composio/core': minor
---

Add `accountType` and per-user ACL support for SHARED connected accounts (Hermes #9860, #9882, #9902).

Surfaces three Apollo-side features that previously had no SDK wrappers:

- **`accountType` on create**: `composio.connectedAccounts.link(userId, authConfigId, { accountType: 'SHARED' })` creates a SHARED connection. Default remains `PRIVATE`. SHARED is reachable from a tool-router session by other users in the project, but only when explicitly pinned and only when the requesting `userId` passes the connection's ACL.
- **`accountType` on retrieve**: `get()` and `list()` responses now include `accountType` (`'PRIVATE' | 'SHARED'`).
- **`aclConfigForShared` on create + retrieve**: per-user ACL block — `{ allowAllUsers, allowedUserIds, notAllowedUserIds }`. On responses the whole block is `undefined` for non-creator/non-API-key callers (the backend strips it), so callers can distinguish *"I can't see the ACL"* from *"ACL is the default deny-by-default state"*.
- **`updateAcl()` method** (new): `composio.connectedAccounts.updateAcl(nanoid, { allowAllUsers, allowedUserIds, notAllowedUserIds })` writes the ACL via `PATCH /connected_accounts/{id}` (the SDK serialises to the wire's `acl_config_for_shared` block). Backend rejects ACL writes on PRIVATE rows with `ComposioAclOnlyForSharedError` (400). PATCH semantics — omit a field to leave it unchanged; pass an empty array to clear an allow/deny list. At least one field required.
- **`ToolRouterSession.authorize()` options gain `accountType` + `aclConfigForShared`**, so a SHARED connection with an ACL can be created in one call from inside a tool-router session.

ACL resolution rule (deny wins):

1. requesting `userId` ∈ `notAllowedUserIds` → DENY
2. `allowAllUsers === true` → ALLOW
3. requesting `userId` ∈ `allowedUserIds` → ALLOW
4. otherwise → DENY (deny-by-default)

Backend caps: each ACL list ≤1000 entries; each `userId` 1..256 chars. The SDK enforces these caps via Zod at the input boundary.

New error classes:

- `ComposioSharedAccessDeniedError` (403) — surfaces from direct `connectedAccountId` execution paths when the requesting user fails the ACL.
- `ComposioAclOnlyForSharedError` (400) — sent ACL fields on a PRIVATE row.
- `ComposioSharedConnectionNotAccessibleError` (400) — tool-router session create / PATCH with a pinned SHARED connection the session user cannot use.

No breaking changes. Existing `link()` callers without the new options get a `PRIVATE` connection exactly as today; existing `get()` / `list()` callers see new optional fields.

The Python SDK mirror ships in a separate PR — same wire contract, same release train.
