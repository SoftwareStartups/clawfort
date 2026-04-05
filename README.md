# ClawFort

ClawFort is a secure self-hosted AI gateway on Hetzner VPS — routes requests to OpenRouter through Citadel content guardrails, accessible only via Tailscale VPN. Full stack provisioned with Pulumi IaC.

## Stack

| Component | Role |
|-----------|------|
| **OpenClaw** (`@openclaw/cli`) | AI gateway, listens on `127.0.0.1:18789` |
| **Citadel OSS** | Guardrails middleware, listens on `127.0.0.1:3333` |
| **GOG** | Google Calendar CLI tool; runs as `gog-user` via socket activation |
| **OpenRouter** | Unified LLM proxy (Claude, GPT-4, Llama, etc.) |
| **Nginx** | Reverse proxy (Tailscale IP → gateway) |
| **Tailscale** | Zero-trust VPN, only access path |
| **Hetzner CCX13** | VPS host (Ubuntu 24.04 LTS) |
| **Systemd (user)** | Service management with lingering |
| **Pulumi + ESC** | IaC provisioning + encrypted secrets |

Add your own tools via the registry — see `infra/config/tool-registry.ts`.

## Quick Start

### 1. Prerequisites

Follow [docs/prerequisites.md](docs/prerequisites.md) to set up accounts, generate keys, and populate the Pulumi ESC environment.

### 2. Deploy

```bash
task install && task up
```

Pulumi provisions the server, installs all software, configures services, and injects secrets — no manual SSH required.

### 3. Verify

```bash
task verify
```

See [docs/verification.md](docs/verification.md) for manual check details.

## Tasks

Run `task --list` to see all available tasks. Key tasks:

| Task | Description |
|------|-------------|
| `task install` | Install infra/ dependencies (pnpm) |
| `task check` | Lint + format-check + typecheck (parallel) |
| `task lint` | ESLint |
| `task lint:fix` | ESLint --fix |
| `task format` | Prettier write |
| `task format:check` | Prettier check |
| `task typecheck` | tsc --noEmit |
| `task preview` | Pulumi dry-run |
| `task up` | Deploy to production |
| `task destroy` | Tear down all resources (with confirmation) |
| `task outputs` | Show stack outputs (IPs, server ID) |
| `task info` | Display server IP, hostname, and server ID |
| `task ssh` | SSH into the server via Tailscale |
| `task verify` | Run post-deploy health checks |
| `task keys:ssh` | Generate SSH keypair for Hetzner |
| `task keys:token` | Generate a random gateway auth token |

## Operations

Manage services and view logs remotely without SSH:

```bash
# Service management
task server:status     # show openclaw + citadel status
task server:restart    # restart both services
task server:stop       # stop both services
task server:start      # start both services

# Logs
task logs:openclaw     # recent openclaw logs
task logs:citadel      # recent citadel logs
task logs:nginx        # recent nginx logs
task logs:follow       # follow openclaw + citadel logs (live)

# Security checks
task security:firewall   # UFW status
task security:isolation  # tool user isolation checks
task security:audit      # all security checks
```

## Docs

- [docs/prerequisites.md](docs/prerequisites.md) — Accounts, keys, and ESC setup
- [docs/deployment.md](docs/deployment.md) — Running and managing deployments
- [docs/verification.md](docs/verification.md) — Post-deploy health checks
- [docs/references.md](docs/references.md) — External references
