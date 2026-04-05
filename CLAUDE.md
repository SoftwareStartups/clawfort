# ClawFort

Secure self-hosted AI gateway on Hetzner VPS with zero-trust networking and content guardrails. Pulumi IaC in `infra/`. See subdirectory CLAUDE.md files for domain-specific guidance (`infra/`, `infra/config/`, `docs/`, `.github/`).

## Commands

Run from repo root via Taskfile (`brew install go-task`):

```bash
# Development
task install         # pnpm install in infra/
task check           # lint + format-check + typecheck (parallel)
task lint:fix        # ESLint --fix
task format          # Prettier write
pre-commit install   # install git hooks after cloning

# Deployment
task preview         # pulumi preview --stack prod
task up              # pulumi up --stack prod
task verify          # post-deploy health checks
task redeploy        # destroy + redeploy full cycle
task outputs         # show stack outputs (IPs, server ID)
task url             # web UI URL with auth token

# Server Access
task ssh             # SSH into server
task ssh -- '<cmd>'  # run remote command (e.g. task ssh -- 'systemctl --user status openclaw')

# Server Management
task server:status   # openclaw + citadel status
task server:restart  # restart openclaw + citadel
task logs:follow     # follow openclaw + citadel logs (live)
task logs:openclaw   # recent openclaw logs
task logs:citadel    # recent citadel logs

# Security
task security:audit     # run all security checks
task security:isolation # check tool user isolation

# Keys & Config
task keys:token      # generate gateway auth token
task keys:ssh        # generate SSH keypair for Hetzner
task keys:backup     # generate age backup keypair
task devices:list    # list paired/pending devices
task devices:approve -- <id>  # approve a device
```

Full command list: `task --list`

## Key Server Paths

- `~/.openclaw/openclaw.json` — gateway config
- `~/.openclaw/blocklist.txt` — Citadel blocked terms
- `~/.config/systemd/user/openclaw.service` / `citadel.service` — systemd units
- `/home/<tool>-user/bin/<tool>` — tool binaries (root:root, 755)
- `/home/<tool>-user/.env` — tool secrets (600)
- `/run/secure-tools/<tool>.sock` — socket activation endpoints
- `/var/lib/tool-share/<name>/` — tool ↔ openclaw file exchange

## Server Debugging

Connect via `task ssh` then inspect:
```bash
systemctl --user status openclaw        # service state
journalctl --user -u openclaw -f        # live logs
journalctl --user -u citadel -f         # citadel logs
curl http://127.0.0.1:18789/health      # gateway health
systemctl list-sockets "secure-tool-*"  # tool socket status
sudo iptables -L OUTPUT -n | grep owner # egress rules
```

Or run any of these remotely: `task ssh -- '<command>'`

## Updating OpenClaw

Version is in `infra/config/constants.ts` (`OPENCLAW_VERSION`). Before bumping:

```bash
# List recent releases
gh release list --repo openclaw/openclaw --limit 10

# Read changelog for target version
gh release view v<version> --repo openclaw/openclaw
```

Checklist:
1. Read the changelog — check breaking changes and new features
2. Check if registries/templates need updates (config format changes, removed options, new required fields)
3. Bump `OPENCLAW_VERSION` in `infra/config/constants.ts`
4. `task check` — lint, format, typecheck
5. `task preview` — confirm Pulumi plans the expected resource updates

## Invariants

- Verify clean installs work — don't add repair/recovery code
- OpenClaw Skills are managed in the workspace repo, not here
