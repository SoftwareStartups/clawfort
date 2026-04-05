# Architecture

ClawFort is a self-hosted AI gateway with defense-in-depth hardening. This document covers
the system design, trust boundaries, and security model.

## Overview

```
                     Internet
                        │
               ┌────────▼────────┐
               │   Tailscale VPN  │  (only ingress path)
               └────────┬────────┘
                        │ HTTPS (Tailscale Serve)
               ┌────────▼────────┐
               │      Nginx       │  reverse proxy on localhost
               └────────┬────────┘
                        │ HTTP 127.0.0.1:18789
               ┌────────▼────────┐
               │    OpenClaw      │  AI gateway (auth, routing, sandbox)
               └────────┬────────┘
                        │ HTTP 127.0.0.1:3333
               ┌────────▼────────┐
               │   Citadel OSS    │  content guardrails
               └────────┬────────┘
                        │ HTTPS
               ┌────────▼────────┐
               │   OpenRouter     │  unified LLM proxy (external)
               └─────────────────┘

  Tools (invoked on demand via socket activation):

  openclaw ──socat──► /run/secure-tools/gog.sock            ──► systemd ──► gog-user            ──► googleapis.com
```

All components run on a single Hetzner CCX13 (Ubuntu 24.04 LTS). No inbound ports are open
on the public interface — access is exclusively through the Tailscale overlay network.

## Components

### OpenClaw (AI Gateway)

- Listens on `127.0.0.1:18789`
- Enforces bearer token authentication on every request
- Routes completions to Citadel, which proxies to OpenRouter
- Invokes MCP tools as child processes via stdio transport
- Sandbox enabled (`allowNetwork: false`) — tool processes cannot open arbitrary connections

### Citadel OSS (Guardrails)

- Listens on `127.0.0.1:3333`
- Intercepts all LLM requests between OpenClaw and OpenRouter
- Applies blocklist filtering and content safety rules

### Memory & Semantic Search

OpenClaw maintains a searchable memory of past conversations using sqlite-vec for vector storage.

- Memory stored at `~/.openclaw/memory/<agentId>.sqlite`
- Hybrid search: 70% vector similarity (cosine) + 30% BM25 keyword matching
- Embedding provider: Gemini `text-embedding-004` (auto-detected from `GEMINI_API_KEY` env var)
- sqlite-vec enables native vector distance queries in SQLite (falls back to JS cosine similarity if unavailable)
- Memory files (`MEMORY.md`, `memory/YYYY-MM-DD.md`) in the workspace are also indexed
- File watcher auto-reindexes on changes (1.5s debounce)

### CLI Tools & MCP Servers

Tools are invoked on demand via systemd socket activation (inetd-style). Each tool has a
dedicated socket at `/run/secure-tools/<name>.sock` — systemd spawns a per-connection service
instance with stdin/stdout wired to the socket, running as the tool's dedicated OS user.

There are two tool types, both using the same socket activation isolation:

- **CLI tools** (GOG) — standalone binaries downloaded from GitHub Releases,
  owned by `root:root`. Invoked by OpenClaw via workspace skills that call the wrapper script.
- **MCP servers** — no MCP tools are registered by default. Add your own via `tool-registry.ts`.

| Tool | Type | User | Binary | Secret | Egress |
|------|------|------|--------|--------|--------|
| GOG | CLI tool | `gog-user` | `/home/gog-user/bin/gog` | `~/.env` (GOG_KEYRING_PASSWORD) | googleapis.com only |

OpenClaw invokes each tool via a wrapper script that connects to the socket:

```
/home/openclaw/bin/<tool>  →  socat - UNIX-CONNECT:/run/secure-tools/<tool>.sock
                                 →  systemd spawns secure-tool-<tool>@.service as <tool-user>
```

Tool services are hardened with 11 systemd directives (see [Systemd Service Hardening](#systemd-service-hardening)).
Environment is clean by default (systemd service isolation).

See [Tool Isolation](tool-isolation.md) for the full design rationale and alternatives considered.

### Nginx

- Binds to `127.0.0.1:80` (localhost only)
- Tailscale Serve provides HTTPS on the Tailscale interface, proxying to Nginx
- Not reachable from the public internet

### Tailscale

- Provides the only ingress path to the server
- Grants restricted to `tcp:443` (HTTPS via Tailscale Serve); no raw port 22
- Tailscale Serve provides automatic HTTPS with valid certificates
- All SSH access via Tailscale SSH (`tailscale ssh`) — sshd is disabled after provisioning
- Device posture enforced: macOS + stable Tailscale + auto-update

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  Tailnet (trusted zone)                                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Server (openclaw user)                              │   │
│  │                                                      │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │  CLI isolation boundary (per-tool OS user)        │   │   │
│  │  │  one dedicated user per registered tool              │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Boundary 1 — Network perimeter:** UFW blocks all inbound on the public interface. Only
Tailscale traffic (`tailscale0`) is accepted.

**Boundary 2 — Authentication:** Every request to OpenClaw requires a bearer token. Requests
without a valid token are rejected before reaching Citadel or any LLM.

**Boundary 3 — Content guardrails:** Citadel filters all prompts and responses against a
configurable blocklist before they reach OpenRouter.

**Boundary 4 — Tool process isolation:** Each tool runs as a dedicated OS user via systemd
socket activation — each invocation spawns a fresh service instance with a clean environment.
No shared home, environment, or credentials with `openclaw` or each other.

**Boundary 5 — Egress isolation:** iptables OUTPUT rules restrict each tool user to exactly
one external host. A compromised tool cannot reach any other API, the LLM gateway, or the
local network.

## Hardening Layers

### Network

| Control | Detail |
|---------|--------|
| UFW default deny | All inbound blocked; sshd disabled after provisioning |
| Tailscale SSH only | `tailscale ssh` with identity + posture auth; no sshd |
| No public HTTP/HTTPS | Nginx on localhost; Tailscale Serve on `tailscale0` |
| iptables egress per tool user | Each CLI user locked to a single external host |

### Authentication & Access

| Control | Detail |
|---------|--------|
| sshd disabled | Disabled after provisioning; Tailscale SSH is the only access path |
| Root login disabled | sshd hardening config as defense-in-depth during provisioning window |
| Bearer token on gateway | `openssl rand -hex 32` — stored in Pulumi ESC |
| Tailscale ACLs | Deny-by-default within the Tailnet |

### Process Isolation

| Control | Detail |
|---------|--------|
| Dedicated OS users per tool | One per registered tool (e.g. `gog-user`) — no login shell needed |
| Root-owned binaries | Tool binaries owned by `root:root`, 755 — not modifiable by any user process |
| Per-user home (chmod 700) | Tool user homes invisible to `openclaw` |
| Secrets chmod 600 | `.env` files owned by and readable only by the tool user |
| Socket activation | Each tool invocation spawns a fresh systemd service — clean environment by default |
| NoNewPrivileges on tools | Tool services run with `NoNewPrivileges=true` — no privilege escalation |

### Systemd Service Hardening

**Tool services** (`secure-tool-*@.service`) run with the full set of 11 hardening directives:

```ini
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
```

Tools with shared directories (configured via `sharedDir` in the registry) also have `ReadWritePaths=/var/lib/tool-share/<name>`
to exempt the shared directory from `ProtectSystem=strict`.

**OpenClaw and Citadel services** run with the same directives except `ProtectHome` — they need
write access to their home directory (`~/.openclaw/`, `~/citadel/`). Instead they use
`ReadWritePaths=%h` to allow home writes while `ProtectSystem=strict` protects system directories.

### Software Supply Chain

| Control | Detail |
|---------|--------|
| Pinned versions in code | `OPENCLAW_VERSION`, `CITADEL_VERSION`, `NODEJS_MAJOR_VERSION`, and tool `version` fields in `constants.ts` / `tool-registry.ts` |
| CLI binaries from GitHub Releases | Downloaded over HTTPS from the canonical release endpoint |
| No package manager for tools | Binaries deployed directly — no npm/pip dependency tree at runtime |
| Node.js via NodeSource | Official distribution channel |
| unattended-upgrades enabled | OS security patches applied automatically |
| fail2ban | Brute-force protection on SSH |

### Secrets Management

All secrets are stored in Pulumi ESC and never committed to the repository.

| Secret | Where used | How delivered |
|--------|-----------|---------------|
| `gatewayAuthToken` | OpenClaw `gateway.yaml` | Written by Pulumi via openclaw connection |
| `openrouterApiKey` | OpenClaw environment | Injected as systemd `Environment=` |
| `geminiApiKey` | OpenClaw environment | Injected as systemd `Environment=` |
| Tool secrets (per registry) | `<tool>-user/.env` | Auto-derived from `tool-registry.ts`; written by Pulumi via root connection |
| `tailscaleAuthKey` | cloud-init | Single-use ephemeral key; invalid after join |
| `sshPrivateKey` | Pulumi remote commands | Never written to disk on the server |

Tool secrets are written via the **root connection** (before root login is disabled) and are
never visible to the `openclaw` user. The root connection is only used during the initial
deploy phase; subsequent Pulumi runs use the `openclaw` connection.

## Accepted Risks

| Risk | Reason | Mitigation |
|------|--------|------------|
| Device pairing via CLI | Devices must be approved server-side via `openclaw devices approve` before accessing the Control UI | Tailscale-only access; approval scoped per browser profile; revocable via `openclaw devices revoke` |
| CSP `unsafe-inline`/`unsafe-eval` | Required by OpenClaw SPA (Lit web components) | No mitigation possible without upstream changes |
| Hetzner firewall SSH from `0.0.0.0/0` | Needed for Pulumi provisioning during first deploy | sshd disabled after Phase 6; fail2ban protects provisioning window |
| Docker group membership | Required for OpenClaw sandbox (`allowNetwork: false`) | Effective root for `openclaw` user; mitigated by Tailscale-only access and single-operator model |
| Gemini embedding API (external call) | Memory search requires embedding computation | Single bounded dependency; only embedding vectors sent (not conversation content); free tier sufficient |

## Deployment Model

### Update Strategy

This is a single-box deployment with acceptable downtime. The primary update path is **server rebuild**: bump a version in `constants.ts` or `tool-registry.ts`, run `task up`, and Pulumi destroys and recreates the server from scratch. This gives a known-good state on every deploy.

For application-layer components (OpenClaw, Citadel, versioned tool binaries), Pulumi `triggers` are also set on the relevant install commands. Bumping only those versions lets Pulumi re-run the affected steps and restart services on the existing server without a full rebuild — but the rebuild path always works too.

OS-level components (Tailscale, Docker, Node.js, Nginx, Ubuntu packages) are installed via cloud-init, which runs only at server creation. Updating these always requires a full server rebuild.

### Provisioning Phases

Pulumi provisions the server in sequential phases to respect trust boundaries:

```
Phase 1: HetznerServer       — provision VPS, run cloud-init
           └─ cloud-init: system update, Tailscale, UFW, Node.js, OpenClaw CLI,
                          create tool users, iptables egress, socket units

Phase 2: ServerHardening     — via root connection
           └─ SSH hardening, sysctl tuning, fail2ban

Phase 3: (parallel root tasks + Tailscale)
  ├─ TailscaleSetup          — verify Tailscale, capture IP/hostname, configure Serve
  ├─ LogManagement           — configure journald, logrotate
  └─ ToolSetup               — via root connection: install binaries, write .env files

Phase 3b: AppInstall         — via openclaw (Tailscale IP); depends on TailscaleSetup
Phase 4: NginxProxy          — depends on TailscaleSetup
Phase 4b: WorkspaceSetup     — via openclaw; clone/init workspace
Phase 5: SystemdServices     — depends on AppInstall + NginxProxy + LogManagement + ToolSetup
Phase 6: SSH lockdown        — disable sshd, remove port 22 from UFW
```

The root connection is used in phases 2, 3, and 6 (`ServerHardening`, `ToolSetup`, SSH lockdown).
All other phases use the `openclaw` user connection via the Tailscale IP.

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| External attacker reaching the gateway | UFW + Tailscale; no public ports open |
| Unauthenticated LLM access | Bearer token required on every request |
| Prompt injection / harmful content | Citadel guardrails on all completions |
| Compromised LLM response exfiltrates data | iptables egress on tool users; OpenClaw sandbox |
| Tool binary replaced by `openclaw` | Binaries owned by root — not writable by openclaw |
| Tool reads another tool's secrets | Per-user homes (chmod 700); no shared credentials |
| Tool reaches arbitrary internet hosts | iptables OUTPUT rules; each user limited to one host |
| Secrets leak into tool environment | Systemd service isolation — tool processes start with a clean environment |
| Server compromise via SSH brute force | sshd disabled; Tailscale SSH with identity + posture auth |
| Stale OS vulnerabilities | unattended-upgrades; Hetzner server backups enabled |
