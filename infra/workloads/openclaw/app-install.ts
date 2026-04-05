import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { ConnectionArgs } from "../../types";
import { GATEWAY_PORT, OPENCLAW_BIN, OPENCLAW_VERSION } from "../../config/constants";
import { openclawConfig } from "../../templates/services/openclaw-config";
import { CitadelSetup } from "./citadel-setup";

export interface AppInstallArgs {
  openclawConnection: ConnectionArgs;
  secrets: {
    gatewayAuthToken: pulumi.Input<string>;
    openrouterApiKey: pulumi.Input<string>;
    telegramBotToken: pulumi.Input<string>;
    telegramUserId: pulumi.Input<string>;
    exaApiKey: pulumi.Input<string>;
    firecrawlApiKey: pulumi.Input<string>;
  };
  tailscaleHostname: pulumi.Input<string>;
  serverId: pulumi.Input<number>;
}

export class AppInstall extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: AppInstallArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:AppInstall", name, {}, opts);

    const conn = args.openclawConnection;

    // Install openclaw globally first so the onboard command is available
    const installOpenClaw = new command.remote.Command(
      `${name}-install-openclaw`,
      {
        connection: conn,
        create: `/usr/bin/npm install -g --prefix ~/.local openclaw@${OPENCLAW_VERSION}`,
        triggers: [OPENCLAW_VERSION, args.serverId],
      },
      { parent: this }
    );

    // Build Control UI assets from source (scripts/ui.js not included in npm package)
    const buildControlUi = new command.remote.Command(
      `${name}-build-control-ui`,
      {
        connection: conn,
        create: `set -euo pipefail
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
git clone --depth 1 --branch v${OPENCLAW_VERSION} https://github.com/openclaw/openclaw.git "$TMPDIR"
cd "$TMPDIR"
corepack enable --install-directory=$HOME/.local/bin
export PATH="$HOME/.local/bin:$PATH"
pnpm install
pnpm ui:build
cp -r dist/control-ui ~/.local/lib/node_modules/openclaw/dist/control-ui`,
        triggers: [OPENCLAW_VERSION, args.serverId],
      },
      { parent: this, dependsOn: [installOpenClaw] }
    );

    // Run openclaw onboard — key passed via temp file + env var to avoid /proc/*/cmdline exposure
    const onboardOpenClaw = new command.remote.Command(
      `${name}-onboard-openclaw`,
      {
        connection: conn,
        create: pulumi.interpolate`set -euo pipefail
KEYFILE=$(mktemp /tmp/oc-key-XXXXXX)
trap 'rm -f "$KEYFILE"' EXIT
printf '%s' '${args.secrets.openrouterApiKey}' > "$KEYFILE"
chmod 600 "$KEYFILE"
export OPENROUTER_API_KEY="$(cat "$KEYFILE")"
export ANTHROPIC_API_KEY="dummy"
${OPENCLAW_BIN} onboard --non-interactive --accept-risk \
  --mode local \
  --auth-choice apiKey \
  --token-provider openrouter \
  --token "$OPENROUTER_API_KEY" \
  --gateway-port ${GATEWAY_PORT} \
  --gateway-bind loopback \
  --skip-daemon \
  --skip-skills \
  --skip-health
rm -rf ~/.openclaw/workspace`,
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [installOpenClaw] }
    );

    // Build browser sandbox image from source (setup subcommand removed in v2026.3.23)
    const buildBrowserImage = new command.remote.Command(
      `${name}-build-browser-image`,
      {
        connection: conn,
        create: `set -euo pipefail
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
git clone --depth 1 --branch v${OPENCLAW_VERSION} https://github.com/openclaw/openclaw.git "$TMPDIR"
cd "$TMPDIR"
bash scripts/sandbox-browser-setup.sh`,
        triggers: [OPENCLAW_VERSION, args.serverId],
      },
      { parent: this, dependsOn: [onboardOpenClaw] }
    );

    const installSqliteVec = new command.remote.Command(
      `${name}-install-sqlite-vec`,
      {
        connection: conn,
        create: "/usr/bin/npm install -g --prefix ~/.local sqlite-vec",
        triggers: [OPENCLAW_VERSION, args.serverId],
      },
      { parent: this, dependsOn: [onboardOpenClaw] }
    );

    const createLogsDir = new command.remote.Command(
      `${name}-create-logs-dir`,
      {
        connection: conn,
        create: "mkdir -p ~/.openclaw/logs",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [onboardOpenClaw] }
    );

    const citadel = new CitadelSetup(
      `${name}-citadel`,
      {
        openclawConnection: conn,
        serverId: args.serverId,
      },
      { parent: this, dependsOn: [onboardOpenClaw] }
    );

    // Write openclaw.json — secrets resolved via pulumi.all(), written as a single heredoc
    const configOutput = pulumi
      .all([
        args.secrets.gatewayAuthToken,
        args.secrets.telegramBotToken,
        args.secrets.telegramUserId,
        args.secrets.exaApiKey,
        args.secrets.firecrawlApiKey,
        args.tailscaleHostname,
      ])
      .apply(
        ([
          authToken,
          telegramBotToken,
          telegramUserId,
          exaApiKey,
          firecrawlApiKey,
          tailscaleHostname,
        ]) => {
          const config = openclawConfig(
            { authToken, telegramBotToken, telegramUserId, exaApiKey, firecrawlApiKey },
            { tailscaleHostname }
          );
          return JSON.stringify(config, null, 2);
        }
      );

    // Stop openclaw before writing config to prevent file-watcher clobber loop
    const stopOpenClaw = new command.remote.Command(
      `${name}-stop-openclaw-for-config`,
      {
        connection: conn,
        create: `systemctl --user stop openclaw 2>/dev/null || true`,
        triggers: [configOutput, args.serverId],
      },
      {
        parent: this,
        dependsOn: [citadel, installSqliteVec, buildBrowserImage, createLogsDir, buildControlUi],
      }
    );

    const writeJsonConfig = new command.remote.Command(
      `${name}-write-json-config`,
      {
        connection: conn,
        create: pulumi.interpolate`set -euo pipefail
CONFIG=~/.openclaw/openclaw.json
cat <<'CFGEOF' > "$CONFIG"
${configOutput}
CFGEOF
chmod 600 "$CONFIG"`,
        triggers: [configOutput, args.serverId],
      },
      { parent: this, dependsOn: [stopOpenClaw] }
    );

    // Enable channel plugins after config is written — the CLI mutates openclaw.json
    const enableChannelPlugins = new command.remote.Command(
      `${name}-enable-channel-plugins`,
      {
        connection: conn,
        create: `${OPENCLAW_BIN} plugins enable telegram`,
        triggers: [configOutput, args.serverId],
      },
      { parent: this, dependsOn: [writeJsonConfig] }
    );

    // Restart openclaw after config write (no-op on fresh deploy where service isn't enabled yet)
    const restartOpenClaw = new command.remote.Command(
      `${name}-restart-openclaw-after-config`,
      {
        connection: conn,
        create: `systemctl --user is-enabled openclaw 2>/dev/null && systemctl --user start openclaw || true`,
        triggers: [configOutput, args.serverId],
      },
      { parent: this, dependsOn: [enableChannelPlugins] }
    );

    this.completed = restartOpenClaw.stdout;

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
