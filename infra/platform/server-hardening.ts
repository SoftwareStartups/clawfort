import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { join } from "path";
import { ConnectionArgs } from "../types";
import { NODEJS_MAJOR_VERSION } from "../config/constants";

export interface ServerHardeningArgs {
  rootConnection: ConnectionArgs;
  serverId: pulumi.Input<number>;
}

export class ServerHardening extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: ServerHardeningArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:ServerHardening", name, {}, opts);

    const conn = args.rootConnection;

    const waitForCloudInit = new command.remote.Command(
      `${name}-wait-for-cloud-init`,
      {
        connection: conn,
        create: "timeout 900 cloud-init status --wait || (cloud-init status --long; exit 1)",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const verifyPackages = new command.remote.Command(
      `${name}-verify-packages`,
      {
        connection: conn,
        create:
          "DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=60 install -y socat jq build-essential age && mkdir -p /etc/iptables && /usr/sbin/iptables-save > /etc/iptables/rules.v4 && /usr/sbin/ip6tables-save > /etc/iptables/rules.v6",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [waitForCloudInit] }
    );

    const verifyNodeJs = new command.remote.Command(
      `${name}-verify-nodejs`,
      {
        connection: conn,
        create: `which npm && npm --version || (curl -fsSL https://deb.nodesource.com/setup_${NODEJS_MAJOR_VERSION}.x | bash - && apt-get install -y nodejs)`,
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [verifyPackages] }
    );

    // Fan out independent config writes after cloud-init; apt-get commands stay serial (dpkg lock)
    new command.remote.CopyToRemote(
      `${name}-copy-ssh-config`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../assets/security/sshd-hardening.conf")
        ),
        remotePath: "/etc/ssh/sshd_config.d/99-openclaw.conf",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [waitForCloudInit] }
    );

    const copySysctl = new command.remote.CopyToRemote(
      `${name}-copy-sysctl`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../assets/system/sysctl-hardening.conf")
        ),
        remotePath: "/etc/sysctl.d/99-openclaw-hardening.conf",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [waitForCloudInit] }
    );

    // sysctl --system must run after the file lands
    const applySysctl = new command.remote.Command(
      `${name}-apply-sysctl`,
      {
        connection: conn,
        create: "sysctl --system",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [copySysctl] }
    );

    // fail2ban: copy config then install+start (apt-get must come before systemctl)
    const copyFail2ban = new command.remote.CopyToRemote(
      `${name}-copy-fail2ban`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../assets/security/fail2ban-jail.conf")
        ),
        remotePath: "/etc/fail2ban/jail.local",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [verifyNodeJs] }
    );

    const installFail2ban = new command.remote.Command(
      `${name}-install-fail2ban`,
      {
        connection: conn,
        create:
          "apt-get install -y fail2ban && systemctl enable fail2ban && systemctl restart fail2ban",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [copyFail2ban] }
    );

    const enableUnattendedUpgrades = new command.remote.Command(
      `${name}-enable-unattended-upgrades`,
      {
        connection: conn,
        create:
          "apt-get install -y unattended-upgrades && DEBIAN_FRONTEND=noninteractive dpkg-reconfigure -plow unattended-upgrades",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [installFail2ban] }
    );

    // NOTE: SSH restart + UFW lockdown is deferred to a final step in index.ts
    // so that all provisioning commands (which connect via public IP as root or
    // openclaw) can complete before port 22 is restricted to tailscale0.

    this.completed = pulumi
      .all([applySysctl.stdout, enableUnattendedUpgrades.stdout, verifyNodeJs.stdout])
      .apply(([, , out]) => out);

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
