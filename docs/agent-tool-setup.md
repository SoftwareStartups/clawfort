# Agent & Tool Configuration

How the OpenClaw agent connects to CLI tools and MCP servers.

## Multi-Agent Configuration

OpenClaw uses a multi-agent architecture. Each agent gets its own workspace directory at `~/.openclaw/workspace-<agentId>`.

The "main" agent is configured in `openclaw.json` under `agents.list`:

```json5
{
  "agents": {
    "defaults": {
      "model": { "primary": "openrouter/openrouter/auto" },
      // ... sandbox, memorySearch, etc.
    },
    "list": [
      {
        "id": "main",
        "default": true,
        "workspace": "~/.openclaw/workspace-main"
      }
    ]
  },
  "tools": {
    "byProvider": {
      "gog": { "deny": ["calendar create", "calendar update", "calendar delete", ...] }
    }
  }
}
```

Key points:

- **`agents.defaults`** contains shared config (model, sandbox, memorySearch) — no workspace here
- **`agents.list[].workspace`** sets the per-agent workspace path
- **`tools.byProvider`** blocks write operations per tool at the gateway level

## Workspace Skills for CLI Tools

CLI tool binaries (like GOG) are not MCP servers. They are configured as **workspace skills** that instruct the agent to invoke them via `exec` + wrapper script.

Skill files live in the agent's workspace:

```
~/.openclaw/workspace-main/skills/
  gog/SKILL.md
```

### Example skill (`gog/SKILL.md`)

```markdown
---
name: gog
---

# gog

Run this tool via exec:

\`\`\`bash
/home/openclaw/bin/gog <arguments>
\`\`\`

Run with `--help` for available commands and options.

## Security

- Runs as isolated OS user `gog-user` (via socket activation)
- Egress restricted to: googleapis.com
- Binary owned by root (not writable by tool user)
- Secrets in `/home/gog-user/.env` (chmod 600)
```

The agent discovers these skills from the workspace and uses `exec` to run the wrapper. The wrapper connects to the tool's socket, and systemd spawns the tool binary as the dedicated OS user. No MCP protocol is involved.

> **Note:** Skills are managed in the workspace repo, not infra. Updating skill files to use wrapper paths (`/home/openclaw/bin/<tool>` instead of `sudo -u <user> <binary>`) is a separate workspace-side change.

### Creating skill files manually

Skill files are not auto-deployed. Create them by hand in the agent's workspace:

```bash
mkdir -p ~/.openclaw/workspace-main/skills/<tool-name>
# then write SKILL.md in that directory
```

#### SKILL.md frontmatter reference

**Required fields:**

| Field | Description |
|-------|-------------|
| `name` | Skill identifier |
| `description` | Shown to agent for relevance matching |

**Useful optional fields:**

| Field | Description |
|-------|-------------|
| `version` | Semantic version |
| `user-invocable: true` | Expose as slash command |
| `disable-model-invocation: true` | Manual-only invocation |
| `metadata.openclaw.requires.env` | Required env vars |
| `metadata.openclaw.requires.bins` | Required binaries |
| `metadata.openclaw.requires.config` | Required config keys |
| `metadata.openclaw.primaryEnv` | Primary env var name |
| `metadata.openclaw.os` | OS filter (`linux`, `darwin`) |
| `metadata.openclaw.emoji` | Display emoji |
| `metadata.openclaw.homepage` | Homepage URL |

> Tool allow/deny is configured at the **agent level** (`agents.list[].tools.deny` in `openclaw.json`), not in skill frontmatter.

## Security Model

### Why two integration patterns?

| Tool | Pattern | Reason |
|------|---------|--------|
| gog | Skill + exec + wrapper | Standalone CLI binary (Google Calendar) |

Add more tools via `infra/config/tool-registry.ts`.

### Isolation layers

Both patterns share the same OS-level isolation via systemd socket activation:

1. **Dedicated OS user** per tool (e.g. `gog-user`)
2. **Socket activation** — each invocation spawns a fresh systemd service with a clean environment
3. **NoNewPrivileges** on both openclaw and tool services — no privilege escalation anywhere
4. **iptables egress rules** restrict each user to their specific API domain
5. **Secrets isolation** each tool's `.env` is `chmod 600`, owned by its tool user
6. **Root-owned binaries** tool users cannot modify their own executables

All CLI tools use the same invocation pattern: the agent reads `SKILL.md`, learns the invocation pattern, and runs via `exec` through the wrapper script.

## Native Plugin Integration

Exa and Firecrawl are configured as **native plugins** rather than MCP servers. Native plugins provide tighter integration with OpenClaw's built-in web search and fetch capabilities, and avoid embedding API keys in URL templates.

Plugins are defined in `infra/config/plugin-registry.ts` and generate two config sections in `openclaw.json`:

- **`plugins.entries`** — registers each plugin with its API key
- **`tools.web`** — configures web search provider and web fetch settings

### Adding a new plugin

1. Add entry to `plugins` array in `infra/config/plugin-registry.ts`
2. Add secret config key to Pulumi ESC and `OpenClawConfig` in `infra/config/index.ts`
3. Config generation in `openclaw-config.ts` picks it up automatically via the registry
