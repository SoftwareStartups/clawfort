# Verification

Post-deploy health checks. Run `task verify` for automated checks, or follow this guide for full manual coverage.

## Prerequisites

- You are on the Tailscale network (`tailscale status`)
- You have the stack outputs: `task outputs`

## Automated Checks

```bash
task verify          # core health checks (services, endpoints, MCP tools, auth)
task security:audit  # security checks (firewall, SSH hardening, Tailscale, tool isolation)
```

## Manual Checks

### 1. Services

SSH into the server and verify both services are active:

```bash
# Both should show "active (running)"
systemctl --user status openclaw citadel
```

### 2. Local Endpoints (OpenClaw + Citadel)

```bash
curl http://127.0.0.1:18789/health   # OpenClaw
curl http://127.0.0.1:3333/health    # Citadel → {"status":"ok"}
```

### 3. Tailscale Serve

SSH into the server and check:

```bash
sudo tailscale serve status
```

Expected output:

```
https://<hostname>.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:80
```

> Also covered by `task security:tailscale`.

### 4. HTTPS via Tailscale

From your local machine:

```bash
# Get your hostname from stack outputs
HOSTNAME=$(task outputs | grep tailscaleHostname | awk '{print $2}')

# Health check over HTTPS
curl https://$HOSTNAME/health
```

Should return a successful health response.

### 5. Auth Enforcement

```bash
# Without token — must return 401
curl -s -o /dev/null -w "%{http_code}" https://$HOSTNAME/v1/chat/completions

# With token — should return 200
curl -H "Authorization: Bearer <YOUR_AUTH_TOKEN>" https://$HOSTNAME/v1/chat/completions
```

### 6. CLI Tool Isolation

SSH into the server and verify the sandboxed CLI setup:

```bash
# All registered tool users exist
for socket in /run/secure-tools/*.sock; do
  tool=$(basename "$socket" .sock)
  id "${tool}-user"
done

# Binaries are root-owned and executable (binary tools only)
for socket in /run/secure-tools/*.sock; do
  tool=$(basename "$socket" .sock)
  bin="/home/${tool}-user/bin/${tool}"
  [ -f "$bin" ] && ls -la "$bin"
done
# Expected: -rwxr-xr-x 1 root root

# Secret files are owned by each tool user, not readable by others
for socket in /run/secure-tools/*.sock; do
  tool=$(basename "$socket" .sock)
  ls -la "/home/${tool}-user/.env"
done
# Expected: -rw------- 1 <user> <user>

# iptables egress rules are in place
sudo iptables -L OUTPUT -n | grep owner

# sudoers entry is correct
sudo cat /etc/sudoers.d/cli-isolation
```

> Also covered by `task security:isolation`.

### 7. Firewall

SSH into the server:

```bash
sudo ufw status verbose
```

Expected rules (and nothing else inbound):

- `22/tcp` on `tailscale0` (SSH)
- `80/tcp` on `tailscale0` (HTTP — used by Tailscale Serve internally)
- `41641/udp` ALLOW (Tailscale direct peer connections)

Port 18789 must NOT appear — it is localhost-only.

> Also covered by `task security:firewall`.

### 8. Fail2ban

```bash
sudo fail2ban-client status sshd
```

Should show an active jail with `Currently banned: 0` (unless there were attack attempts).

### 9. Memory & Embeddings

SSH into the server and verify memory search is operational:

```bash
# sqlite-vec native module is loadable
node -e "require('sqlite-vec')"

# Memory directory exists with correct ownership
ls -la ~/.openclaw/memory/
# Expected: drwxr-xr-x openclaw openclaw

# Gemini API key is in the service environment file (not visible via systemctl show)
test -f ~/.openclaw/.env.service && grep -q GEMINI_API_KEY ~/.openclaw/.env.service && echo "GEMINI_API_KEY OK"
# Expected: GEMINI_API_KEY OK

# Memory search is configured in openclaw.json
jq '.memory' ~/.openclaw/openclaw.json
# Expected: {"enabled": true, "search": {"enabled": true, ...}}

# After sending a test message, check indexing in logs
journalctl --user -u openclaw --since "5 min ago" | grep -i -E "memory|embedding|index"
```

### 10. Certificate Validity

```bash
curl -v https://$HOSTNAME/health 2>&1 | grep -E "SSL|issuer|expire"
```

Tailscale issues certificates automatically via Let's Encrypt. Should show a valid cert.

### 11. Reboot Persistence

```bash
sudo reboot
```

After reboot (wait ~60 seconds):

```bash
systemctl --user status openclaw citadel   # both active
curl http://127.0.0.1:18789/health         # responds
sudo tailscale serve status                # serve config persists
sudo iptables -L OUTPUT -n | grep owner    # egress rules survive reboot
```

## Production Checklist

Before going to production:

- [ ] All checks above pass
- [ ] `task verify` and `task security:audit` both green
- [ ] `sudo ufw status` shows ONLY expected rules
- [ ] HTTPS cert is valid (step 10)
- [ ] Auth enforcement returns 401 without token (step 5)
- [ ] Reboot persistence confirmed (step 11)
- [ ] Backup secrets: ESC values stored in 1Password or encrypted vault
- [ ] Hetzner console shows daily backup schedule enabled
- [ ] Monitor logs 10 min: `journalctl --user -u openclaw -f` (no repeated errors)
