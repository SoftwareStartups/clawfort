import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { ConnectionArgs } from "../types";
import { stdioTools, binaryTools, npmTools } from "../config/tool-registry";
import {
  generateBinaryInstallCommand,
  generateBunInstallCommand,
  generateNpmPreInstallCommand,
  toolWrapperScript,
} from "./tool-generators";
import { BUN_VERSION } from "../config/constants";

export interface ToolSetupArgs {
  rootConnection: ConnectionArgs;
  secrets: Record<string, pulumi.Input<string>>;
  configBundles?: Record<string, pulumi.Input<string>>;
  serverId: pulumi.Input<number>;
}

export class ToolSetup extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: ToolSetupArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:ToolSetup", name, {}, opts);

    const conn = args.rootConnection;
    const installByName: Record<string, command.remote.Command> = {};

    // Install binary tools
    for (const tool of binaryTools()) {
      const install = new command.remote.Command(
        `${name}-install-${tool.name}-binary`,
        {
          connection: conn,
          create: generateBinaryInstallCommand(tool),
          triggers: tool.version ? [tool.version, args.serverId] : [args.serverId],
        },
        { parent: this }
      );
      installByName[tool.name] = install;
    }

    // Install Bun runtime (for npm-based MCP tools)
    const npmDefs = npmTools();
    let bunInstall: command.remote.Command | undefined;
    if (npmDefs.length > 0) {
      bunInstall = new command.remote.Command(
        `${name}-install-bun`,
        {
          connection: conn,
          create: generateBunInstallCommand(),
          triggers: [BUN_VERSION, args.serverId],
        },
        { parent: this }
      );
    }

    // Pre-install npm tool packages (runs as root — unaffected by per-user iptables egress rules)
    for (const tool of npmDefs) {
      const install = new command.remote.Command(
        `${name}-install-${tool.name}-npm`,
        {
          connection: conn,
          create: generateNpmPreInstallCommand(tool),
          triggers: tool.version ? [tool.version, args.serverId] : [args.serverId],
        },
        { parent: this, dependsOn: bunInstall ? [bunInstall] : [] }
      );
      installByName[tool.name] = install;
    }

    // Create bin dir and deploy wrapper scripts
    const createBinDir = new command.remote.Command(
      `${name}-create-bin-dir`,
      {
        connection: conn,
        create: "mkdir -p /home/openclaw/bin && chown openclaw:openclaw /home/openclaw/bin",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    for (const tool of stdioTools()) {
      const script = toolWrapperScript(`/run/secure-tools/${tool.name}.sock`);

      const copyWrapper = new command.remote.CopyToRemote(
        `${name}-wrapper-${tool.name}`,
        {
          connection: conn,
          source: new pulumi.asset.StringAsset(script),
          remotePath: `/home/openclaw/bin/${tool.name}`,
          triggers: [args.serverId],
        },
        { parent: this, dependsOn: [createBinDir] }
      );

      new command.remote.Command(
        `${name}-chmod-wrapper-${tool.name}`,
        {
          connection: conn,
          create: `chmod 755 /home/openclaw/bin/${tool.name}`,
          triggers: [args.serverId],
        },
        { parent: this, dependsOn: [copyWrapper] }
      );
    }

    // Write .env files for all tools
    const envCommands: command.remote.Command[] = [];
    for (const tool of stdioTools()) {
      const envLines = tool.secrets.map(
        (s) => pulumi.interpolate`${s.envVar}=${args.secrets[s.configKey]}`
      );

      const envContent = pulumi.all(envLines).apply((lines) => lines.join("\n"));

      const dependsOn = installByName[tool.name] ? [installByName[tool.name]] : [];

      const writeEnv = new command.remote.Command(
        `${name}-write-${tool.name}-env`,
        {
          connection: conn,
          create: pulumi.interpolate`cat > /home/${tool.osUser}/.env <<'ENVEOF'
${envContent}
ENVEOF
chown ${tool.osUser}:${tool.osUser} /home/${tool.osUser}/.env && chmod 600 /home/${tool.osUser}/.env`,
          triggers: [args.serverId],
        },
        { parent: this, dependsOn }
      );
      envCommands.push(writeEnv);
    }

    // Provision config bundles (base64-encoded tarballs unpacked into ~/.config/)
    const bundleCommands: command.remote.Command[] = [];
    for (const tool of binaryTools()) {
      if (!args.configBundles?.[tool.name]) continue;

      const bundle = args.configBundles[tool.name];
      const dependsOn = installByName[tool.name] ? [installByName[tool.name]] : [];

      const unpack = new command.remote.Command(
        `${name}-config-${tool.name}`,
        {
          connection: conn,
          create: pulumi.interpolate`mkdir -p /home/${tool.osUser}/.config && \
echo '${bundle}' | base64 -d | tar -xzf - -C /home/${tool.osUser}/.config/ && \
chown -R ${tool.osUser}:${tool.osUser} /home/${tool.osUser}/.config && \
find /home/${tool.osUser}/.config -type f -exec chmod 600 {} + && \
find /home/${tool.osUser}/.config -type d -exec chmod 700 {} +`,
          triggers: [bundle, args.serverId],
        },
        { parent: this, dependsOn }
      );
      bundleCommands.push(unpack);
    }

    this.completed = pulumi
      .all([...envCommands, ...bundleCommands].map((c) => c.stdout))
      .apply((outputs) => outputs.join(""));

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
