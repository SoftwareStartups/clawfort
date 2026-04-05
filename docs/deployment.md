# Deployment

Running and managing the OpenClaw stack with Pulumi.

## Quick Deploy

```bash
task install   # install infra/ dependencies
task preview   # dry-run: show what will be created/changed
task up        # deploy to production
```

## Stack Outputs

After a successful deploy:

```bash
task outputs
```

Key outputs:

| Output | Description |
|--------|-------------|
| `ipv4Address` | Server's public IPv4 (for DNS / reference) |
| `tailscaleIp` | Server's Tailscale IP (use for SSH) |
| `tailscaleHostname` | Server's Tailscale MagicDNS hostname (use for HTTPS access) |
| `serverId` | Hetzner server ID |

## Accessing the Gateway

Once deployed, access OpenClaw via:

- **Web UI:** `https://<tailscaleHostname>` (requires Tailscale network)
- **Telegram:** message your bot (configured via `telegramBotToken` in ESC)

Tailscale Serve provides automatic HTTPS with valid certificates for the web UI.

## What Pulumi Does

`task up` runs through 6 phases in `infra/app/index.ts`:

1. **HetznerServer** — SSH key, firewall (ICMP + SSH + WireGuard), CCX13 Ubuntu 24.04 LTS with cloud-init bootstrap (Node.js, Tailscale, UFW, tool users, iptables, socket units)
2. **ServerHardening** — SSH config, sysctl tuning, fail2ban, unattended-upgrades (via root)
3. **Parallel:** TailscaleSetup (verify + Serve + UFW), LogManagement (logrotate, journald), ToolSetup (binary downloads, .env files) — all via root
4. **AppInstall** — OpenClaw onboard, Citadel download, gateway config, openclaw.json (via Tailscale IP)
5. **NginxProxy** + **WorkspaceSetup** — reverse proxy config, git clone workspace
6. **SystemdServices** — env file, daemon-reload, enable + start citadel/openclaw
7. **SSH lockdown** — disable sshd, remove port 22 from UFW

Secrets from Pulumi ESC are injected automatically via the `Pulumi.prod.yaml` environment link — no wrapper scripts needed.

## MCP Tool Isolation

All tools run as **sandboxed processes** with OS-level isolation via systemd socket activation. Tool definitions live in a typed registry (`infra/config/tool-registry.ts`) that generates cloud-init, gateway config, and setup commands automatically.

There are two tool types:
- **CLI tools** (GOG) — standalone binaries downloaded from GitHub Releases, owned by `root`. Invoked via workspace skills + wrapper script.
- **MCP servers** — npm packages run via `bun`. No MCP tools registered by default — add your own via `tool-registry.ts`.

Both types use socket activation under the hood:
- Each tool runs as its own OS user (e.g. `gog-user`) via systemd socket activation
- Wrapper scripts in `/home/openclaw/bin/` connect to `/run/secure-tools/<tool>.sock` via `socat`
- Systemd spawns a per-connection service instance as the tool user with a clean environment
- Tool services run with `NoNewPrivileges=true` — no privilege escalation anywhere
- Secrets live in each user's home directory (`chmod 600`), inaccessible to other users
- iptables egress rules restrict each user to its registered API hosts only (defined in `tool-registry.ts`)

## Post-Deployment Access

After deployment, sshd is disabled. All access is via Tailscale:

```bash
# SSH maintenance (via Tailscale SSH — no SSH keys needed)
tailscale ssh openclaw@<tailscale-hostname>
# or: task ssh

# Web UI
https://<tailscale-hostname>/#token=<gateway-auth-token>
# or: task url
```

### Device Pairing

After a fresh deployment, **two** device pairing requests appear because two independent clients connect to the gateway:

1. **Control UI (web browser)** — registers a pairing request when you first open the web interface.
2. **Telegram bot** — registers its own pairing request when the channel is activated during deployment.

Both must be approved for full functionality. Each browser profile and channel maintains its own device identity.

**Workflow:**

1. Open `https://<tailscale-hostname>/#token=<gateway-auth-token>` — the browser shows "pairing required"
2. From the host, run one of:
   - `task devices:list` (runs the command remotely via Tailscale SSH), or
   - `task ssh` then `~/.local/bin/openclaw devices list` on the server
3. Approve both requests: `task devices:approve -- <requestId>`
4. Revoke if needed: `task devices:revoke -- <id>`
5. Refresh the browser — the Control UI loads normally

The device is remembered per browser profile. You only need to pair once per browser/channel.

### Tailscale SSH Setup (macOS)

1. Install Tailscale: `brew install --cask tailscale` (or Mac App Store)
2. Sign in: open Tailscale from menu bar → Sign In
3. Verify: `tailscale status` (should show your tailnet)
4. Connect: `tailscale ssh openclaw@<tailscaleHostname>`

No SSH keys needed on your machine — Tailscale authenticates based on your device
identity and posture (macOS + stable Tailscale + auto-update).

### Incremental Updates

Pulumi connects via the Tailscale IP. Tailscale SSH intercepts and authenticates
by node identity — no sshd required.

```bash
# Bump version in infra/config/constants.ts
task up    # incremental — only changed resources re-run
```

Incremental updates work for: OpenClaw version, Citadel version, service restarts.
Root-level changes (tool binaries, nginx, OS packages) require full rebuild:

```bash
# Rotate Tailscale auth key in ESC first (ephemeral keys are single-use)
task redeploy
```

### Rescue

If the server becomes unreachable (Tailscale outage, misconfiguration):

```bash
task redeploy    # destroy + recreate from scratch
```

The workspace is backed up via git — no data loss.

### Redeployment Workflow

```bash
# 1. Bump version(s) in infra/config/constants.ts or infra/config/tool-registry.ts
# 2. Rotate the Tailscale auth key in ESC (ephemeral keys are single-use)
pulumi env set openclaw/prod pulumiConfig.openclaw:tailscaleAuthKey <NEW_KEY> --secret
# 3. Destroy and recreate (unprotect is handled automatically by task destroy)
task redeploy
# 4. Verify
task verify
```

> **Tailscale auth key:** Ephemeral auth keys are consumed on first use and cannot be reused. You must generate a new key in the Tailscale admin console and update ESC before each new deployment.

## Updates

### Philosophy

This is a single-box deployment with no HA requirement. Downtime is acceptable. The primary update path is therefore **server rebuild**: destroy and recreate the server from scratch. This is simpler and more reliable than in-place patching — every deploy is a known-good state.

```bash
# 1. Bump version(s) in infra/config/constants.ts or infra/config/tool-registry.ts
# 2. Rotate Tailscale auth key in ESC if needed
# 3. Destroy and redeploy
task redeploy
# 4. Verify
task verify
```

### What's Versioned

| Component | Version location | Update mechanism |
|-----------|-----------------|-----------------|
| OpenClaw | `OPENCLAW_VERSION` in `constants.ts` | Server rebuild |
| Citadel | `CITADEL_VERSION` in `constants.ts` | Server rebuild |
| GOG | `version` + `sha256` in `tool-registry.ts` | Server rebuild |
| sqlite-vec | Global npm package | Server rebuild |
| Node.js | `NODEJS_MAJOR_VERSION` in `constants.ts` | Server rebuild |
| Ubuntu image | `ubuntu-24.04` in `hetzner-server.ts` | Server rebuild |
| Tailscale | latest (via install script) | Server rebuild |
| Docker | latest (via install script) | Server rebuild |
| Nginx | latest (via apt) | OS auto-updates |

### Pulumi Triggers (component-level, same server)

For OpenClaw, Citadel, and versioned binary tools, Pulumi `triggers` are set on the install commands. If you bump only those versions, Pulumi will re-run the affected install commands and restart services **without rebuilding the server**. This is an optimisation — the full rebuild path always works too.

OS-level components (Tailscale, Docker, Node.js, Nginx, Ubuntu packages) are installed via cloud-init, which only runs at server creation. Updating these always requires a full rebuild.

## Secret Rotation

To rotate any secret:

```bash
# Example: rotate the OpenRouter API key
pulumi env set openclaw/prod pulumiConfig.openclaw:openrouterApiKey <NEW_KEY> --secret

# Redeploy to apply
task up
```

Pulumi will diff the change, update the server config, and restart affected services.

## Tear Down

The Hetzner server resource is protected (`protect: true`) to prevent accidental deletion. `task destroy` automatically unprotects the server before destroying:

```bash
task destroy        # prompts for confirmation, runs backup, unprotects, then destroys
```

To unprotect manually (e.g. for selective resource removal):

```bash
task unprotect      # removes protection from the server resource
```

> **Warning:** This destroys the Hetzner server and all data on it. Back up any persistent data before running.
