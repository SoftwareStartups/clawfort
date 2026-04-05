---
paths:
  - "infra/**/*.ts"
---

- Never create resources inside `apply()` — they won't appear in `pulumi preview`
- Always pass `{ parent: this }` when creating children inside a ComponentResource; call `registerOutputs()` at end
- Wrap credential-adjacent values with `pulumi.secret()`
- Use explicit `dependsOn` for cross-component ordering; implicit deps only within a component
- Trigger arrays: `[serverId]` once-per-server | `[VERSION, serverId]` version bumps | `[contentHash(...), serverId]` config changes
- Remote commands use create+update pattern (never delete — server teardown handles cleanup)
- Use `aliases` when renaming resources to avoid destroy+create
- Run `pulumi` directly — never via npx or pnpm
- Invoke the `pulumi` skill for detailed patterns (Output handling, resource options, ESC, transforms)
