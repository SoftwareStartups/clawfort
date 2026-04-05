import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { join } from "path";
import { ConnectionArgs } from "../../types";

export interface LogManagementArgs {
  rootConnection: ConnectionArgs;
  serverId: pulumi.Input<number>;
}

export class LogManagement extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: LogManagementArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:LogManagement", name, {}, opts);

    const rootConn = args.rootConnection;

    // Independent branches — no ordering needed between logrotate, fixHomePerms, and journald
    new command.remote.CopyToRemote(
      `${name}-copy-logrotate`,
      {
        connection: rootConn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../../assets/system/logrotate-openclaw.conf")
        ),
        remotePath: "/etc/logrotate.d/openclaw",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const fixHomePerms = new command.remote.Command(
      `${name}-fix-home-perms`,
      {
        connection: rootConn,
        create: "chmod 755 /home/openclaw",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const copyJournald = new command.remote.CopyToRemote(
      `${name}-copy-journald`,
      {
        connection: rootConn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../../assets/system/journald-size.conf")
        ),
        remotePath: "/etc/systemd/journald.conf.d/size.conf",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const restartJournald = new command.remote.Command(
      `${name}-restart-journald`,
      {
        connection: rootConn,
        create: "systemctl restart systemd-journald",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [copyJournald] }
    );

    this.completed = pulumi
      .all([fixHomePerms.stdout, restartJournald.stdout])
      .apply(([, out]) => out);

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
