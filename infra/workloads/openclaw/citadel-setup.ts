import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { ConnectionArgs } from "../../types";
import {
  CITADEL_VERSION,
  CITADEL_BINARY_URL,
  CITADEL_BINARY_SHA256,
  CITADEL_PLUGIN_URL,
  CITADEL_PLUGIN_SHA256,
  CITADEL_PLUGIN_VERSION,
  OPENCLAW_BIN,
} from "../../config/constants";

export interface CitadelSetupArgs {
  openclawConnection: ConnectionArgs;
  serverId: pulumi.Input<number>;
}

export class CitadelSetup extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: CitadelSetupArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:CitadelSetup", name, {}, opts);

    const conn = args.openclawConnection;

    const installBinary = new command.remote.Command(
      `${name}-install-citadel-binary`,
      {
        connection: conn,
        create: `set -euo pipefail
mkdir -p ~/citadel
curl -fsSL ${CITADEL_BINARY_URL} -o ~/citadel/citadel
echo "${CITADEL_BINARY_SHA256}  $HOME/citadel/citadel" | sha256sum -c
chmod 755 ~/citadel/citadel`,
        triggers: [CITADEL_VERSION, args.serverId],
      },
      { parent: this }
    );

    const installPlugin = new command.remote.Command(
      `${name}-install-citadel-plugin`,
      {
        connection: conn,
        create: `set -euo pipefail

# Remove stale extension dirs from prior installs so config validation
# doesn't choke on leftover directories missing a root-level manifest.
rm -rf ~/.openclaw/extensions/citadel-guard ~/.openclaw/extensions/citadel-guard-openclaw

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
curl -fsSL ${CITADEL_PLUGIN_URL} -o "$TMPDIR/plugin.tgz"
echo "${CITADEL_PLUGIN_SHA256}  $TMPDIR/plugin.tgz" | sha256sum -c
${OPENCLAW_BIN} plugins install "$TMPDIR/plugin.tgz" --dangerously-force-unsafe-install`,
        triggers: [CITADEL_PLUGIN_VERSION, args.serverId],
      },
      { parent: this, dependsOn: [installBinary] }
    );

    this.completed = installPlugin.stdout;

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
