import { BUN_VERSION } from "../config/constants";
import { type BinaryTool, type NpmTool } from "../config/tool-registry";

function npmBinName(npmPackage: string): string {
  const parts = npmPackage.split("/");
  return parts[parts.length - 1];
}

export function generateCliUsersBlock(defs: readonly (BinaryTool | NpmTool)[]): string {
  const lines: string[] = [];
  for (const tool of defs) {
    lines.push(`  - useradd -m -s /bin/bash ${tool.osUser}`);
    lines.push(`  - chmod 700 /home/${tool.osUser}`);
    if (tool.type === "binary") {
      lines.push(`  - mkdir -p /home/${tool.osUser}/bin`);
    }
    if (tool.writablePaths) {
      for (const relPath of tool.writablePaths) {
        lines.push(`  - mkdir -p /home/${tool.osUser}/${relPath}`);
        lines.push(`  - chown ${tool.osUser}:${tool.osUser} /home/${tool.osUser}/${relPath}`);
      }
    }
  }
  return lines.join("\n");
}

export function generateSharedDirsBlock(defs: readonly (BinaryTool | NpmTool)[]): string {
  const toolsWithSharedDir = defs.filter((t) => t.sharedDir);
  if (toolsWithSharedDir.length === 0) return "";

  const lines: string[] = ["", "  # Create shared directories for tool ↔ openclaw file exchange"];

  for (const tool of toolsWithSharedDir) {
    const dir = tool.sharedDir!;
    const group = `tool-${dir}-share`;
    lines.push(`  - groupadd ${group}`);
    lines.push(`  - usermod -aG ${group} openclaw`);
    lines.push(`  - usermod -aG ${group} ${tool.osUser}`);
    lines.push(`  - mkdir -p /var/lib/tool-share/${dir}`);
    lines.push(`  - chown root:${group} /var/lib/tool-share/${dir}`);
    lines.push(`  - chmod 2770 /var/lib/tool-share/${dir}`);
  }

  return lines.join("\n");
}

// NOTE: iptables resolves domain names to IPs at rule-creation time. If the
// target service rotates IPs, rules go stale. Acceptable for the stable
// services used here (e.g. googleapis.com).
export function generateIptablesBlock(defs: readonly (BinaryTool | NpmTool)[]): string {
  const lines: string[] = [];
  for (const tool of defs) {
    // DNS restricted to systemd-resolved only (prevents DNS tunneling exfiltration)
    lines.push(
      `  - iptables -A OUTPUT -m owner --uid-owner ${tool.osUser} -d 127.0.0.53 -p udp --dport 53 -j ACCEPT`
    );
    lines.push(
      `  - iptables -A OUTPUT -m owner --uid-owner ${tool.osUser} -d 127.0.0.53 -p tcp --dport 53 -j ACCEPT`
    );
    for (const domain of tool.egressDomains) {
      lines.push(
        `  - iptables -A OUTPUT -m owner --uid-owner ${tool.osUser} -d ${domain} -j ACCEPT`
      );
    }
    lines.push(`  - iptables -A OUTPUT -m owner --uid-owner ${tool.osUser} -j DROP`);
  }
  return lines.join("\n");
}

export function generateTmpfilesBlock(): string {
  return [
    "",
    "  # Create /run/secure-tools directory for tool sockets (persists across reboots via tmpfiles.d)",
    "  - |",
    "    cat > /etc/tmpfiles.d/secure-tools.conf <<'EOF'",
    "    d /run/secure-tools 0755 root root -",
    "    EOF",
    "  - systemd-tmpfiles --create /etc/tmpfiles.d/secure-tools.conf",
  ].join("\n");
}

export function generateToolSocketUnitsBlock(defs: readonly (BinaryTool | NpmTool)[]): string {
  const lines: string[] = ["", "  # Create systemd socket-activated units for each tool"];

  for (const tool of defs) {
    const socketPath = `/etc/systemd/system/secure-tool-${tool.name}.socket`;
    const servicePath = `/etc/systemd/system/secure-tool-${tool.name}@.service`;
    const execStart =
      tool.type === "binary"
        ? `/home/${tool.osUser}/bin/${tool.name}`
        : `/usr/local/bin/bun run ${npmBinName((tool as NpmTool).npmPackage)}`;

    // Socket unit
    lines.push("  - |");
    lines.push(`    cat > ${socketPath} <<'EOF'`);
    lines.push("    [Unit]");
    lines.push(`    Description=Secure tool socket for ${tool.name}`);
    lines.push("    [Socket]");
    lines.push(`    ListenStream=/run/secure-tools/${tool.name}.sock`);
    lines.push("    Accept=yes");
    lines.push("    SocketUser=openclaw");
    lines.push("    SocketMode=0600");
    lines.push("    [Install]");
    lines.push("    WantedBy=sockets.target");
    lines.push("    EOF");

    // Service template
    lines.push("  - |");
    lines.push(`    cat > ${servicePath} <<'EOF'`);
    lines.push("    [Unit]");
    lines.push(`    Description=Secure tool ${tool.name} (%i)`);
    lines.push("    [Service]");
    lines.push(`    User=${tool.osUser}`);
    lines.push(`    Group=${tool.osUser}`);
    lines.push(`    WorkingDirectory=/home/${tool.osUser}`);
    lines.push(`    EnvironmentFile=-/home/${tool.osUser}/.env`);
    lines.push(
      `    ExecStart=/bin/bash -c 'read -r n; for ((i=0;i<n;i++)); do IFS= read -r -d "" x; set -- "$@" "$x"; done; exec ${execStart} "$@"'`
    );
    lines.push("    StandardInput=socket");
    lines.push("    StandardOutput=socket");
    lines.push("    StandardError=journal");
    lines.push("    NoNewPrivileges=true");
    lines.push("    ProtectSystem=strict");
    lines.push("    ProtectHome=read-only");
    lines.push("    PrivateTmp=true");
    lines.push("    PrivateDevices=true");
    lines.push("    ProtectKernelTunables=true");
    lines.push("    ProtectKernelModules=true");
    lines.push("    ProtectControlGroups=true");
    lines.push("    RestrictNamespaces=true");
    lines.push("    RestrictRealtime=true");
    lines.push("    RestrictSUIDSGID=true");
    if (tool.sharedDir) {
      lines.push(`    ReadWritePaths=/var/lib/tool-share/${tool.sharedDir}`);
    }
    if (tool.writablePaths) {
      for (const relPath of tool.writablePaths) {
        lines.push(`    ReadWritePaths=/home/${tool.osUser}/${relPath}`);
      }
    }
    lines.push("    EOF");
  }

  // daemon-reload + enable sockets
  lines.push("  - systemctl daemon-reload");
  for (const tool of defs) {
    lines.push(`  - systemctl enable --now secure-tool-${tool.name}.socket`);
  }

  return lines.join("\n");
}

export function toolWrapperScript(sockPath: string): string {
  return [
    "#!/bin/bash",
    "if [ -t 0 ]; then",
    `  { printf '%d\\n' $#; [ $# -gt 0 ] && printf '%s\\0' "$@"; } | exec /usr/bin/socat -t 300 - UNIX-CONNECT:${sockPath}`,
    "else",
    `  { printf '%d\\n' $#; [ $# -gt 0 ] && printf '%s\\0' "$@"; cat; } | exec /usr/bin/socat -t 300 - UNIX-CONNECT:${sockPath}`,
    "fi",
  ].join("\n");
}

export function generateMcpServersJson(
  defs: readonly (BinaryTool | NpmTool)[]
): Record<string, unknown> {
  const servers: Record<string, unknown> = {};
  for (const tool of defs) {
    const entry: Record<string, unknown> = {
      command: `/home/openclaw/bin/${tool.name}`,
    };
    if (tool.commandDeny && tool.commandDeny.length > 0) {
      entry.tools = { deny: [...tool.commandDeny] };
    }
    servers[tool.name] = entry;
  }
  return servers;
}

export function generateBunInstallCommand(): string {
  return [
    `curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip -o /tmp/bun.zip`,
    "unzip -o /tmp/bun.zip -d /tmp/bun-extract",
    "install -m 755 /tmp/bun-extract/bun-linux-x64/bun /usr/local/bin/bun",
    "rm -rf /tmp/bun.zip /tmp/bun-extract",
    "/usr/local/bin/bun --version",
  ].join(" && \\\n");
}

export function generateNpmPreInstallCommand(tool: NpmTool): string {
  const pkg = tool.version ? `${tool.npmPackage}@${tool.version}` : tool.npmPackage;
  const binName = npmBinName(tool.npmPackage);
  return [
    `cd /home/${tool.osUser}`,
    "echo '{}' > package.json",
    `HOME=/home/${tool.osUser} /usr/local/bin/bun add ${pkg}`,
    `chown -R ${tool.osUser}:${tool.osUser} /home/${tool.osUser}`,
    `test -f node_modules/.bin/${binName} && echo "${binName} binary OK"`,
  ].join(" && \\\n");
}

export function generateMaintenanceSudoersBlock(defs: readonly (BinaryTool | NpmTool)[]): string {
  const testEntries = defs.map(
    (tool) => `    openclaw ALL=(ALL) NOPASSWD: /usr/bin/test -f /home/${tool.osUser}/.env`
  );

  return [
    "",
    "    # Maintenance (Taskfile tasks via tailscale ssh)",
    "    openclaw ALL=(ALL) NOPASSWD: /usr/sbin/ufw status verbose",
    "    openclaw ALL=(ALL) NOPASSWD: /usr/sbin/iptables -L OUTPUT -n",
    "    openclaw ALL=(ALL) NOPASSWD: /usr/sbin/sshd -T",
    "    openclaw ALL=(ALL) NOPASSWD: /usr/bin/fail2ban-client status sshd",
    "    openclaw ALL=(ALL) NOPASSWD: /usr/bin/tailscale status",
    "    openclaw ALL=(ALL) NOPASSWD: /usr/bin/tailscale netcheck",
    "    openclaw ALL=(ALL) NOPASSWD: /usr/bin/journalctl -u nginx -n 100 --no-pager",
    "    openclaw ALL=(ALL) NOPASSWD: /usr/bin/cat /etc/sudoers.d/cli-isolation",
    ...testEntries,
  ].join("\n");
}

export function generateBinaryInstallCommand(tool: BinaryTool): string {
  const binPath = `/home/${tool.osUser}/bin/${tool.name}`;

  if (tool.archiveBinaryName) {
    return generateArchiveInstallCommand(tool, binPath);
  }

  if (tool.binaryUrlArm64) {
    const lines = [
      `ARCH=$(uname -m)`,
      `if [ "$ARCH" = "aarch64" ]; then`,
      `  curl -fsSL ${tool.binaryUrlArm64} -o ${binPath}`,
      ...(tool.sha256Arm64 ? [`  echo "${tool.sha256Arm64}  ${binPath}" | sha256sum -c`] : []),
      `else`,
      `  curl -fsSL ${tool.binaryUrl} -o ${binPath}`,
      ...(tool.sha256 ? [`  echo "${tool.sha256}  ${binPath}" | sha256sum -c`] : []),
      `fi`,
      `chown root:root ${binPath}`,
      `chmod 755 ${binPath}`,
    ];
    return lines.join("\n");
  }

  const steps = [`curl -fsSL ${tool.binaryUrl} -o ${binPath}`];
  if (tool.sha256) {
    steps.push(`echo "${tool.sha256}  ${binPath}" | sha256sum -c`);
  }
  steps.push(`chown root:root ${binPath}`, `chmod 755 ${binPath}`);
  return steps.join(" && \\\n");
}

function generateArchiveInstallCommand(tool: BinaryTool, binPath: string): string {
  const tmpArchive = `/tmp/${tool.name}-archive.tar.gz`;
  const extractName = tool.archiveBinaryName!;

  if (tool.binaryUrlArm64) {
    const lines = [
      `ARCH=$(uname -m)`,
      `if [ "$ARCH" = "aarch64" ]; then`,
      `  curl -fsSL ${tool.binaryUrlArm64} -o ${tmpArchive}`,
      ...(tool.sha256Arm64 ? [`  echo "${tool.sha256Arm64}  ${tmpArchive}" | sha256sum -c`] : []),
      `else`,
      `  curl -fsSL ${tool.binaryUrl} -o ${tmpArchive}`,
      ...(tool.sha256 ? [`  echo "${tool.sha256}  ${tmpArchive}" | sha256sum -c`] : []),
      `fi`,
      `tar -xzf ${tmpArchive} -C /tmp ${extractName}`,
      `mv /tmp/${extractName} ${binPath}`,
      `rm -f ${tmpArchive}`,
      `chown root:root ${binPath}`,
      `chmod 755 ${binPath}`,
    ];
    return lines.join("\n");
  }

  const steps = [
    `curl -fsSL ${tool.binaryUrl} -o ${tmpArchive}`,
    ...(tool.sha256 ? [`echo "${tool.sha256}  ${tmpArchive}" | sha256sum -c`] : []),
    `tar -xzf ${tmpArchive} -C /tmp ${extractName}`,
    `mv /tmp/${extractName} ${binPath}`,
    `rm -f ${tmpArchive}`,
    `chown root:root ${binPath}`,
    `chmod 755 ${binPath}`,
  ];
  return steps.join(" && \\\n");
}
