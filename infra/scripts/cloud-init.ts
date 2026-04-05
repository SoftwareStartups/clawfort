import * as pulumi from "@pulumi/pulumi";
import { stdioTools } from "../config/tool-registry";
import {
  generateCliUsersBlock,
  generateSharedDirsBlock,
  generateIptablesBlock,
  generateMaintenanceSudoersBlock,
  generateTmpfilesBlock,
  generateToolSocketUnitsBlock,
} from "../tools/tool-generators";
import { NODEJS_MAJOR_VERSION } from "../config/constants";

export function generateCloudInit(
  sshPublicKey: pulumi.Input<string>,
  tailscaleAuthKey: pulumi.Input<string>
): pulumi.Output<string> {
  const tools = stdioTools();
  const cliUsersBlock = generateCliUsersBlock(tools);
  const sharedDirsBlock = generateSharedDirsBlock(tools);
  const iptablesBlock = generateIptablesBlock(tools);
  const maintenanceSudoersBlock = generateMaintenanceSudoersBlock(tools);
  const tmpfilesBlock = generateTmpfilesBlock();
  const toolSocketUnitsBlock = generateToolSocketUnitsBlock(tools);

  return pulumi.interpolate`#cloud-config
users:
  - name: openclaw
    groups: docker
    shell: /bin/bash
    sudo: null
    ssh_authorized_keys:
      - ${sshPublicKey}

# Disabled: manual apt-get update/dist-upgrade in runcmd controls timing
package_update: false
package_upgrade: false

runcmd:
  # 1. System update (lock timeout avoids race with apt-daily/unattended-upgrades)
  - apt-get -o DPkg::Lock::Timeout=60 update && apt-get -o DPkg::Lock::Timeout=60 dist-upgrade -y

  # 2. Install base packages
  - DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=60 install -y curl ufw git vim htop uidmap pass gnupg jq build-essential age socat unzip

  # 3. Install Docker (required for OpenClaw sandbox)
  - curl -fsSL https://get.docker.com | sh
  - |
    cat > /etc/docker/daemon.json <<'DJEOF'
    {"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}
    DJEOF
  - systemctl enable docker
  - systemctl restart docker
  - usermod -aG docker openclaw
  - docker network create --subnet=172.21.0.0/16 openclaw-sandbox-browser || true

  # 4. Install and configure Tailscale (auth key written to temp file to avoid cloud-init log exposure)
  - curl -fsSL https://tailscale.com/install.sh | sh
  - |
    TS_KEYFILE=$(mktemp /tmp/ts-authkey-XXXXXX)
    trap 'rm -f "$TS_KEYFILE"' EXIT
    printf '%s' '${tailscaleAuthKey}' > "$TS_KEYFILE"
    chmod 600 "$TS_KEYFILE"
    tailscale up --authkey "file:$TS_KEYFILE" --ssh --timeout 60s

  # 5. Configure UFW
  # SSH is kept open on all interfaces here so Pulumi remote provisioning
  # commands can connect via the public IP. The final hardening step in
  # Pulumi (server-hardening.ts) restricts SSH to tailscale0 only after
  # all remote commands have completed.
  - ufw reset --force
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw --force enable

  # 6. Create isolated users for each tool
${cliUsersBlock}
${sharedDirsBlock}

  # 7. Configure iptables egress per tool user
${iptablesBlock}

  # 7b. Persist iptables rules across reboots
  - mkdir -p /etc/iptables && /usr/sbin/iptables-save > /etc/iptables/rules.v4 && /usr/sbin/ip6tables-save > /etc/iptables/rules.v6

${tmpfilesBlock}

  # 8. Configure sudoers for maintenance tasks
  - |
    cat > /etc/sudoers.d/cli-isolation <<'EOF'
${maintenanceSudoersBlock}
    EOF
  - chmod 440 /etc/sudoers.d/cli-isolation

  # 9. Install Node.js ${NODEJS_MAJOR_VERSION}
  - curl -fsSL https://deb.nodesource.com/setup_${NODEJS_MAJOR_VERSION}.x | bash -
  - apt-get install -y nodejs

  # 9b. Enable corepack (provides pnpm for Control UI build)
  - corepack enable

  # 10. Create required directories
  - mkdir -p /home/openclaw/.openclaw/logs /home/openclaw/.openclaw/memory /home/openclaw/.config/systemd/user
  - mkdir -p /var/tmp/openclaw-compile-cache
  - chown openclaw:openclaw /var/tmp/openclaw-compile-cache
  - chown -R openclaw:openclaw /home/openclaw

${toolSocketUnitsBlock}

  # 11. Enable systemd linger for openclaw (services persist after logout)
  - loginctl enable-linger openclaw

  # 12. Start openclaw user's systemd instance (needed during cloud-init)
  - systemctl start user@$(id -u openclaw).service
`;
}
