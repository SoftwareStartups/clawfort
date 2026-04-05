import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";
import { generateCloudInit } from "../scripts/cloud-init";

export interface HetznerServerArgs {
  sshPublicKey: pulumi.Input<string>;
  tailscaleAuthKey: pulumi.Input<string>;
  location?: string;
  serverType?: string;
}

export class HetznerServer extends pulumi.ComponentResource {
  public readonly ipv4Address: pulumi.Output<string>;
  public readonly serverId: pulumi.Output<number>;

  constructor(name: string, args: HetznerServerArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:HetznerServer", name, {}, opts);

    const location = args.location ?? "nbg1";
    const serverType = args.serverType ?? "ccx13";

    const sshKey = new hcloud.SshKey(
      `${name}-deploy`,
      {
        name: `${name}-deploy`,
        publicKey: args.sshPublicKey,
      },
      { parent: this }
    );

    const firewall = new hcloud.Firewall(
      `${name}-firewall`,
      {
        name: `${name}-firewall`,
        rules: [
          {
            direction: "in",
            protocol: "icmp",
            sourceIps: ["0.0.0.0/0", "::/0"],
          },
          {
            // Open during provisioning for command.remote.Command access.
            // UFW on the server restricts SSH to tailscale0 interface only.
            // Kept wide (all IPs) because Pulumi provisioning runs from
            // varying CI/developer IPs; the real restriction is UFW + Tailscale.
            direction: "in",
            protocol: "tcp",
            port: "22",
            sourceIps: ["0.0.0.0/0", "::/0"],
          },
          {
            // Allow Tailscale WireGuard direct peer connections.
            // Without this, all traffic routes through DERP relays (higher latency).
            direction: "in",
            protocol: "udp",
            port: "41641",
            sourceIps: ["0.0.0.0/0", "::/0"],
          },
        ],
      },
      { parent: this }
    );

    const userData = generateCloudInit(args.sshPublicKey, args.tailscaleAuthKey);

    const server = new hcloud.Server(
      name,
      {
        name: name,
        serverType: serverType,
        location: location,
        image: "ubuntu-24.04",
        sshKeys: [sshKey.id],
        firewallIds: [firewall.id.apply(Number)],
        userData: userData,
        backups: true,
      },
      { parent: this, protect: true }
    );

    this.ipv4Address = server.ipv4Address;
    this.serverId = server.id.apply((id) => Number(id));

    this.registerOutputs({
      ipv4Address: this.ipv4Address,
      serverId: this.serverId,
    });
  }
}
