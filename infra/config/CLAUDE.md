# Config: Registry-Driven Setup

Configuration is registry-driven. Registries feed cloud-init generation, `openclaw.json` generation, and secret threading automatically. To add a component: add to registry → add secret to ESC → thread through config.

## Registry Files

| File                  | Defines                           | Key fields                                            |
| --------------------- | --------------------------------- | ----------------------------------------------------- |
| `tool-registry.ts`    | Binary, npm, and HTTP tools       | OS user, secrets, egress domains, `exposeViaMcp` flag |
| `plugin-registry.ts`  | Native plugins (web search/fetch) | API keys, capabilities                                |
| `channel-registry.ts` | Messaging channels                | Channel type, secrets, policy                         |
| `agent-registry.ts`   | AI agents                         | Workspace path, MCP server refs, tool deny lists      |
| `model-registry.ts`   | Available LLM models              | Full model ID, short alias                            |

## Adding a Tool

1. Add entry to `tools[]` in `tool-registry.ts` (set `exposeViaMcp: true` if MCP)
2. Add secret config key(s) to Pulumi ESC (secrets are auto-read from the registry — no manual wiring in `index.ts` or `app-stack.ts`)

## Adding a Plugin

1. Add entry to `plugins[]` in `plugin-registry.ts`
2. Add secret config key to Pulumi ESC and `OpenClawConfig` in `index.ts`
3. Config generation in `openclaw-config.ts` picks it up automatically

## Adding a Channel

1. Add channel type to the union in `channel-registry.ts`
2. Add entry to `channels[]`
3. Add builder logic in `buildChannelConfig()` in `templates/services/openclaw-config.ts`
4. Add secret config key(s) to Pulumi ESC and `OpenClawConfig`

## Adding a Model

1. Add entry to `models[]` in `model-registry.ts` with full OpenClaw model ID and short alias
2. Run `task check` to verify types — the model will automatically appear in generated `openclaw.json`

## Tool Registry Accessor Functions

`tool-registry.ts` exports typed accessor functions for each tool category: `binaryTools()`, `npmTools()`, `httpTools()`, `stdioTools()`, `stdioMcpTools()`. These are intentional extension points — they exist even when no entries of that type are in the registry yet. Do not remove unused accessors; they keep the API surface ready for new tool types.

## Security Invariants

- `NoNewPrivileges=true` is non-negotiable for all systemd services
- Secrets in env files with `chmod 600`, never on command line (avoids `/proc/*/cmdline` exposure)
- Per-tool iptables egress: DNS allowed, then user-specific domain allowlist + DROP all
