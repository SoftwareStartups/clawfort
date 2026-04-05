import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { join } from "path";
import { ConnectionArgs } from "../../types";

export interface BackupSetupArgs {
  openclawConnection: ConnectionArgs;
  serverId: pulumi.Input<number>;
  agePublicKey: string;
}

export class BackupSetup extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: BackupSetupArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:BackupSetup", name, {}, opts);

    const conn = args.openclawConnection;

    const ensureBackupsDir = new command.remote.Command(
      `${name}-ensure-backups-dir`,
      {
        connection: conn,
        create: "mkdir -p ~/backups",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const copyBackupScript = new command.remote.CopyToRemote(
      `${name}-copy-backup-script`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../../assets/services/openclaw-backup.sh")
        ),
        remotePath: "/home/openclaw/bin/openclaw-backup.sh",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const chmodBackupScript = new command.remote.Command(
      `${name}-chmod-backup-script`,
      {
        connection: conn,
        create: "chmod +x ~/bin/openclaw-backup.sh",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [copyBackupScript] }
    );

    const writeAgeRecipients = args.agePublicKey
      ? new command.remote.Command(
          `${name}-write-age-recipients`,
          {
            connection: conn,
            create: [
              `cat > ~/.openclaw/.age-recipients <<'AGEEOF'`,
              args.agePublicKey,
              "AGEEOF",
              "chmod 600 ~/.openclaw/.age-recipients",
            ].join("\n"),
            triggers: [args.serverId, args.agePublicKey],
          },
          { parent: this }
        )
      : undefined;

    const copyBackupTimer = new command.remote.CopyToRemote(
      `${name}-copy-backup-timer`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../../assets/services/openclaw-backup.timer")
        ),
        remotePath: "/home/openclaw/.config/systemd/user/openclaw-backup.timer",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const copyBackupService = new command.remote.CopyToRemote(
      `${name}-copy-backup-service`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../../assets/services/openclaw-backup.service")
        ),
        remotePath: "/home/openclaw/.config/systemd/user/openclaw-backup.service",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const enableBackupTimer = new command.remote.Command(
      `${name}-enable-backup-timer`,
      {
        connection: conn,
        create:
          "systemctl --user daemon-reload && systemctl --user enable --now openclaw-backup.timer",
        triggers: [args.serverId],
      },
      {
        parent: this,
        dependsOn: [
          chmodBackupScript,
          copyBackupTimer,
          copyBackupService,
          ensureBackupsDir,
          ...(writeAgeRecipients ? [writeAgeRecipients] : []),
        ],
      }
    );

    this.completed = enableBackupTimer.stdout;

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
