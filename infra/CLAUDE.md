# Infra: Pulumi IaC

## Directory Layout

| Directory             | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `app/`                | Stack entry point (`index.ts` → `OpenClawStack` component)          |
| `config/`             | Registry files, constants, config types (see `config/CLAUDE.md`)    |
| `platform/`           | Infrastructure primitives: Hetzner VPS, hardening, Tailscale, Nginx |
| `tools/`              | Tool user setup, socket units, wrapper scripts, workspace sync      |
| `workloads/openclaw/` | App install, Citadel build, systemd services, backup, log mgmt      |
| `templates/`          | Dynamic config generators (openclaw.json, nginx.conf)               |
| `assets/`             | Static config files (systemd units, sshd, fail2ban, sysctl)         |
| `scripts/`            | Cloud-init generator                                                |

## Architecture

- Entry: `app/index.ts` reads config via `readConfig()`, instantiates `OpenClawStack`
- `OpenClawStack` is a `ComponentResource` with 7 deployment phases connected by `dependsOn`
- Phase 1: Server provisioning → Phase 2: Hardening → Phase 3: Parallel (Tailscale, Logs, Tools, Nginx) → Phase 4: App install → Phase 5: Parallel (Workspace, Backup) → Phase 6: Systemd services → Phase 7: Final SSH lockdown
- Two connection types: `rootConn` (public IP, initial provisioning) and `openclawConn` (Tailscale IP, incremental updates)

## Code Patterns

Coding rules (parent:this, triggers, secrets, remote commands) are in `.claude/rules/pulumi-guidelines.md` (auto-loaded for `infra/**/*.ts`). Additional project-specific pattern:

- **Assets**: static → `infra/assets/` + `readFileSync()` | dynamic → `infra/templates/` + generator function

## Config Validation

Generated `openclaw.json` is validated on server via `openclaw config validate --json` (included in `task verify`).
