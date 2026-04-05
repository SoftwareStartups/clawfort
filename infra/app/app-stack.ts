import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { OpenClawConfig } from "../config";
import { ConnectionArgs } from "../types";
import { HetznerServer, ServerHardening, TailscaleSetup, NginxProxy } from "../platform";
import { AppInstall, BackupSetup, SystemdServices, LogManagement } from "../workloads/openclaw";
import { ToolSetup, WorkspaceSetup } from "../tools";

// Trigger strategy:
// - [serverId]                       → runs once per server creation
// - [VERSION, serverId]              → runs on version upgrade or recreation
// - [contentHash(...), serverId]     → runs on config change or recreation
export class OpenClawStack extends pulumi.ComponentResource {
  public readonly ipv4Address: pulumi.Output<string>;
  public readonly serverId: pulumi.Output<number>;
  public readonly tailscaleIp: pulumi.Output<string>;
  public readonly tailscaleHostname: pulumi.Output<string>;

  constructor(name: string, config: OpenClawConfig, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:OpenClawStack", name, {}, opts);

    // Phase 1: Provision Hetzner VPS (cloud-init bootstrap)
    const server = new HetznerServer(
      name,
      {
        sshPublicKey: config.sshPublicKey,
        tailscaleAuthKey: config.tailscaleAuthKey,
        location: config.location,
        serverType: config.serverType,
      },
      { parent: this }
    );

    // Root connection — public IP, used during first deploy only.
    // On subsequent `pulumi up`, commands with unchanged triggers are skipped.
    const rootConnection: ConnectionArgs = {
      host: server.ipv4Address,
      user: "root",
      privateKey: config.sshPrivateKey,
    };

    // Phase 2: Harden server (SSH lockdown deferred to Phase 7)
    const hardening = new ServerHardening(
      name,
      {
        rootConnection,
        serverId: server.serverId,
      },
      { parent: this, dependsOn: [server] }
    );

    // Phase 3: Parallel branches after hardening (Tailscale, LogMgmt, ToolSetup, Nginx)

    const tailscale = new TailscaleSetup(
      name,
      {
        rootConnection,
        tailscaleAuthKey: config.tailscaleAuthKey,
        serverId: server.serverId,
      },
      { parent: this, dependsOn: [hardening] }
    );

    const logMgmt = new LogManagement(
      name,
      {
        rootConnection,
        serverId: server.serverId,
      },
      { parent: this, dependsOn: [hardening] }
    );

    const toolSetup = new ToolSetup(
      name,
      {
        rootConnection,
        secrets: config.toolSecrets,
        configBundles: config.toolConfigBundles,
        serverId: server.serverId,
      },
      { parent: this, dependsOn: [hardening] }
    );

    // Openclaw connection — Tailscale IP, used for app-level commands.
    // On first deploy: Tailscale IP resolved after TailscaleSetup, sshd handles connection.
    // On subsequent deploys: sshd is disabled, Tailscale SSH intercepts port 22 on the
    // Tailscale interface and authenticates by node identity. Enables incremental updates.
    const openclawConnection: ConnectionArgs = {
      host: tailscale.tailscaleIp,
      user: "openclaw",
      privateKey: config.sshPrivateKey,
      dialErrorLimit: 40,
      perDialTimeout: 20,
    };

    // Verify the deploying machine can reach the server's Tailscale IP.
    // TailscaleSetup only proves the server-side is ready (commands ran via public IP).
    // This local check proves the WireGuard peer path + SSH port are reachable.
    const tailscalePeerCheck = new command.local.Command(
      `${name}-tailscale-peer-check`,
      {
        create: pulumi.interpolate`
echo "Verifying Tailscale connectivity to ${tailscale.tailscaleIp}:22..."
for i in $(seq 1 30); do
  if nc -z -G 5 ${tailscale.tailscaleIp} 22 2>/dev/null; then
    echo "Tailscale SSH port reachable"
    exit 0
  fi
  echo "Attempt $i/30: port 22 not yet reachable, retrying in 5s..."
  sleep 5
done
echo "ERROR: Cannot reach ${tailscale.tailscaleIp}:22 via Tailscale after 30 attempts"
echo "Diagnostics:"
tailscale status | head -5
echo "Hint: ensure the Tailscale auth key carries tag:server (ACL grants require it)"
exit 1
        `,
        triggers: [server.serverId],
      },
      { parent: this, dependsOn: [tailscale] }
    );

    // Phase 4: AppInstall (PeerCheck + verified Tailscale connectivity)
    const appInstall = new AppInstall(
      name,
      {
        openclawConnection,
        secrets: {
          gatewayAuthToken: config.gatewayAuthToken,
          openrouterApiKey: config.openrouterApiKey,
          telegramBotToken: config.telegramBotToken,
          telegramUserId: config.telegramUserId,
          exaApiKey: config.exaApiKey,
          firecrawlApiKey: config.firecrawlApiKey,
        },
        tailscaleHostname: tailscale.tailscaleHostname,
        serverId: server.serverId,
      },
      { parent: this, dependsOn: [hardening, tailscalePeerCheck] }
    );

    const nginx = new NginxProxy(
      name,
      {
        rootConnection,
        serverId: server.serverId,
      },
      { parent: this, dependsOn: [hardening] }
    );

    // Phase 5: Parallel post-AppInstall (Workspace + Backup)
    const workspace = new WorkspaceSetup(
      name,
      {
        openclawConnection,
        workspaceSshPrivateKey: config.workspaceSshPrivateKey,
        workspaceRepo: config.workspaceRepo,
        serverId: server.serverId,
      },
      { parent: this, dependsOn: [appInstall] }
    );

    // (also Phase 5)
    const backup = new BackupSetup(
      name,
      {
        openclawConnection,
        serverId: server.serverId,
        agePublicKey: config.agePublicKey,
      },
      { parent: this, dependsOn: [appInstall] }
    );

    // Phase 6: Systemd services (needs AppInstall + Nginx + LogMgmt + ToolSetup)
    const services = new SystemdServices(
      name,
      {
        openclawConnection,
        secrets: {
          openrouterApiKey: config.openrouterApiKey,
          geminiApiKey: config.geminiApiKey,
        },
        serverId: server.serverId,
      },
      { parent: this, dependsOn: [appInstall, nginx, logMgmt, toolSetup] }
    );

    // Phase 7: Disable sshd entirely. Tailscale SSH (enabled via `tailscale up --ssh`)
    // serves as the only SSH access path. Pulumi incremental updates connect via the
    // Tailscale IP — Tailscale SSH intercepts and authenticates by node identity.
    new command.remote.Command(
      `${name}-ssh-lockdown`,
      {
        connection: rootConnection,
        create: [
          "systemctl restart ssh",
          "systemctl disable --now ssh",
          "ufw delete allow 22/tcp",
          "ufw reload",
        ].join(" && "),
        triggers: [server.serverId],
      },
      { parent: this, dependsOn: [services, workspace, backup] }
    );

    // Outputs
    this.ipv4Address = server.ipv4Address;
    this.serverId = server.serverId;
    this.tailscaleIp = tailscale.tailscaleIp;
    this.tailscaleHostname = tailscale.tailscaleHostname;

    this.registerOutputs({
      ipv4Address: this.ipv4Address,
      serverId: this.serverId,
      tailscaleIp: this.tailscaleIp,
      tailscaleHostname: this.tailscaleHostname,
    });
  }
}
