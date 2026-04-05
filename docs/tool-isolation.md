# Tool Isolation

Design rationale for the tool isolation architecture in ClawFort.

## Problem Statement

OpenClaw invokes external tools (calendar management, web search) on behalf of AI
agents. These tools hold credentials for third-party APIs. Without isolation, a compromised or
prompt-injected tool invocation could:

- **Steal credentials** from other tools or the gateway itself
- **Modify tool binaries** to inject persistent backdoors
- **Exfiltrate data** to arbitrary internet hosts
- **Escalate privileges** to gain broader system access

## Tool Types

There are two types of tools, both using the same socket activation isolation:

### CLI Tools (GOG)

Standalone binaries downloaded from GitHub Releases, owned by `root:root` (755). OpenClaw
invokes them indirectly — workspace skills call the wrapper script in `/home/openclaw/bin/`,
which connects to the tool's socket. The binary receives arguments via stdin and returns
results via stdout.

### MCP Servers

npm packages run via `bun` that speak the MCP (Model Context Protocol) protocol. No MCP
servers are registered by default, but the registry supports them. When registered, they
appear in `openclaw.json` under `mcp.servers` and are invoked by OpenClaw's MCP transport
through the same wrapper script → socket mechanism.

The distinction matters for how OpenClaw discovers and invokes the tool, but the isolation
boundary is identical: both types run as dedicated OS users via systemd socket activation.

## Approach: Socket Activation + Per-User OS Isolation

Each tool runs as a dedicated OS user via systemd socket activation (inetd-style):

```
OpenClaw (as openclaw)
  → wrapper script (/home/openclaw/bin/<tool>)
    → socat → /run/secure-tools/<tool>.sock
      → systemd spawns secure-tool-<tool>@.service
        → runs as <tool>-user with clean environment
          → tool binary/runtime → external API
```

Each connection spawns a fresh service instance. No persistent daemon, no shared state
between invocations.

### Why Socket Activation

- **Zero idle cost**: no daemon running when tools aren't in use
- **Clean environment**: each invocation starts fresh — no state leakage between calls
- **Systemd manages lifecycle**: automatic cleanup, journal logging, resource accounting
- **Low latency**: 5-20ms activation overhead, negligible vs API round-trip (200-2000ms)
- **Native hardening**: systemd provides 11 security directives out of the box

## Isolation Layers

### 1. OS User Separation

Each tool has a dedicated user (e.g. `gog-user`):
- Home directories are `chmod 700` — invisible to each other and to `openclaw`
- Secrets (`.env` files) are `chmod 600` — readable only by the owning user
- Binaries are owned by `root:root` (755) — not modifiable by any user process

### 2. Systemd Hardening (11 directives)

All `secure-tool-*@.service` instances run with:

| Directive | Protection |
|-----------|-----------|
| `NoNewPrivileges=true` | Prevents privilege escalation via setuid/setgid binaries |
| `ProtectSystem=strict` | Makes `/usr`, `/boot`, `/efi`, `/etc` read-only |
| `ProtectHome=read-only` | Makes all home directories read-only (tool reads `.env` but can't write) |
| `PrivateTmp=true` | Gives tool its own `/tmp` — can't see other processes' temp files |
| `PrivateDevices=true` | Hides physical devices — only pseudo-devices (`/dev/null`, etc.) |
| `ProtectKernelTunables=true` | Makes `/proc/sys`, `/sys` read-only |
| `ProtectKernelModules=true` | Denies loading kernel modules |
| `ProtectControlGroups=true` | Makes `/sys/fs/cgroup` read-only |
| `RestrictNamespaces=true` | Prevents creating new user/network/mount namespaces |
| `RestrictRealtime=true` | Prevents acquiring realtime scheduling |
| `RestrictSUIDSGID=true` | Prevents creating setuid/setgid files |

Tools with shared directories also have `ReadWritePaths=/var/lib/tool-share/<name>` to
exempt the shared directory from the read-only filesystem.

### 3. Network Egress Isolation

iptables OUTPUT rules restrict each tool user to its declared `egressDomains` from `tool-registry.ts`:

- `gog-user` → `oauth2.googleapis.com`, `www.googleapis.com`

DNS is restricted to `127.0.0.53` (systemd-resolved) to prevent DNS tunneling.
All other outbound traffic is DROPped.

## Shared Directory Pattern

Some tools need to share files with OpenClaw. For example, a tool may write output files
that OpenClaw needs to read.

Direct file sharing is blocked by `ProtectHome=read-only` and `chmod 700` home directories.
The solution uses a shared group with setgid:

1. A shared group is created: `tool-<name>-share`
2. Both `openclaw` and the tool user are added to the group
3. A shared directory is created: `/var/lib/tool-share/<name>/`
4. Ownership is set to `root:<group>` with setgid: `chmod 2770`
5. The tool service gets `ReadWritePaths=/var/lib/tool-share/<name>` to bypass `ProtectSystem=strict`

The setgid bit ensures new files inherit the group, so both users can read/write them.

## Alternatives Considered

### No Isolation (native execution)

Run tools directly as the `openclaw` user. Simplest approach but unacceptable — a compromised
tool can read all other tool secrets, modify binaries, and access the gateway config.

### Docker per Tool

Run each tool in its own Docker container. Provides strong isolation but:
- Adds 200-500ms cold start per invocation (vs 5-20ms for socket activation)
- Requires managing Docker images, networking, and volume mounts per tool
- Docker socket access is itself a privilege escalation vector
- Overkill for simple CLI tools that make one API call

### Bubblewrap / nsjail

Lightweight sandboxing via Linux namespaces. Good isolation but:
- Requires `CAP_SYS_ADMIN` or user namespaces (conflicts with `RestrictNamespaces`)
- More complex to configure per tool than systemd units
- Less observable (no journal integration, no `systemctl` management)

### V8 / Deno Isolates

Run tools in V8 isolates or Deno's permission model. Only works for JavaScript/TypeScript
tools — our CLI tools are compiled Go binaries.

### Firecracker / microVMs

Maximum isolation via lightweight VMs. Massive overkill for single-API-call tools — adds
seconds of startup time and significant operational complexity.

### Credential Broker

Proxy all API calls through a broker that injects credentials. Eliminates credential
exposure but requires per-API proxy implementation, doesn't protect against binary
modification, and adds latency to every call.

## Performance

Socket activation adds 5-20ms per invocation (systemd spawns the service, connects
stdin/stdout to the socket). This is negligible compared to the external API round-trip
(typically 200-2000ms for external API calls).

No persistent daemon runs when tools are idle — zero memory and CPU cost.
