import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { join } from "path";
import { readFileSync } from "fs";
import { ConnectionArgs } from "../../types";
import { OPENCLAW_VERSION, CITADEL_VERSION, CITADEL_PORT } from "../../config/constants";
import { contentHash } from "../../config/content-hash";

export interface SystemdServicesArgs {
  openclawConnection: ConnectionArgs;
  secrets: {
    openrouterApiKey: pulumi.Input<string>;
    geminiApiKey: pulumi.Input<string>;
  };
  serverId: pulumi.Input<number>;
}

export class SystemdServices extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: SystemdServicesArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:SystemdServices", name, {}, opts);

    const conn = args.openclawConnection;

    const servicesDir = join(__dirname, "../../assets/services");
    const citadelServiceHash = contentHash(
      readFileSync(join(servicesDir, "citadel.service"), "utf-8")
    );
    const openclawServiceHash = contentHash(
      readFileSync(join(servicesDir, "openclaw.service"), "utf-8")
    );

    // Write secrets to EnvironmentFile (not inline in unit, so systemctl show won't leak them)
    const writeEnvFile = new command.remote.Command(
      `${name}-write-env-file`,
      {
        connection: conn,
        create: pulumi.interpolate`mkdir -p /var/tmp/openclaw-compile-cache
cat > ~/.openclaw/.env.service <<'__ENVEOF__'
OPENROUTER_API_KEY=${args.secrets.openrouterApiKey}
GEMINI_API_KEY=${args.secrets.geminiApiKey}
NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
OPENCLAW_NO_RESPAWN=1
PATH=/home/openclaw/bin:/usr/local/bin:/usr/bin:/bin
__ENVEOF__
chmod 600 ~/.openclaw/.env.service`,
        triggers: [args.secrets.openrouterApiKey, args.secrets.geminiApiKey, args.serverId],
      },
      { parent: this }
    );

    const copyCitadelService = new command.remote.CopyToRemote(
      `${name}-copy-citadel-service`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../../assets/services/citadel.service")
        ),
        remotePath: "/home/openclaw/.config/systemd/user/citadel.service",
        triggers: [citadelServiceHash, args.serverId],
      },
      { parent: this }
    );

    const copyOpenclawService = new command.remote.CopyToRemote(
      `${name}-copy-openclaw-service`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../../assets/services/openclaw.service")
        ),
        remotePath: "/home/openclaw/.config/systemd/user/openclaw.service",
        triggers: [openclawServiceHash, args.serverId],
      },
      { parent: this, dependsOn: [writeEnvFile] }
    );

    const daemonReload = new command.remote.Command(
      `${name}-daemon-reload`,
      {
        connection: conn,
        create: "systemctl --user daemon-reload",
        triggers: [citadelServiceHash, openclawServiceHash, args.serverId],
      },
      { parent: this, dependsOn: [copyCitadelService, copyOpenclawService] }
    );

    const enableServices = new command.remote.Command(
      `${name}-enable-services`,
      {
        connection: conn,
        create: "systemctl --user enable citadel openclaw",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [daemonReload] }
    );

    const startServices = new command.remote.Command(
      `${name}-start-services`,
      {
        connection: conn,
        create: `systemctl --user restart citadel && timeout 300 bash -c 'until curl -sf http://127.0.0.1:${CITADEL_PORT}/health >/dev/null; do sleep 2; done' && systemctl --user restart openclaw`,
        triggers: [
          OPENCLAW_VERSION,
          CITADEL_VERSION,
          citadelServiceHash,
          openclawServiceHash,
          args.serverId,
        ],
      },
      { parent: this, dependsOn: [enableServices] }
    );

    this.completed = startServices.stdout;

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
