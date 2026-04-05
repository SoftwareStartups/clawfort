import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { ConnectionArgs } from "../types";

export interface TailscaleSetupArgs {
  rootConnection: ConnectionArgs;
  tailscaleAuthKey: pulumi.Input<string>;
  serverId: pulumi.Input<number>;
}

export class TailscaleSetup extends pulumi.ComponentResource {
  public readonly tailscaleIp: pulumi.Output<string>;
  public readonly tailscaleHostname: pulumi.Output<string>;
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: TailscaleSetupArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:TailscaleSetup", name, {}, opts);

    const rootConn = args.rootConnection;

    // Ensure Tailscale is authenticated (cloud-init may have timed out or failed)
    // Uses both create and update so every `pulumi up` re-checks auth
    const tailscaleAuthCmd = pulumi.interpolate`timeout 10 tailscale status --json 2>/dev/null | python3 -c "import sys,json; exit(0 if json.load(sys.stdin).get('BackendState')=='Running' else 1)" || (TS_KEYFILE=$(mktemp /tmp/ts-authkey-XXXXXX) && trap 'rm -f "$TS_KEYFILE"' EXIT && printf '%s' '${args.tailscaleAuthKey}' > "$TS_KEYFILE" && chmod 600 "$TS_KEYFILE" && tailscale up --authkey "file:$TS_KEYFILE" --ssh --timeout 60s)`;
    const ensureTailscale = new command.remote.Command(
      `${name}-ensure-tailscale`,
      {
        connection: rootConn,
        create: tailscaleAuthCmd,
        update: tailscaleAuthCmd,
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const getTailscaleIp = new command.remote.Command(
      `${name}-get-tailscale-ip`,
      {
        connection: rootConn,
        create: "tailscale ip -4 | tr -d '\\n'",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [ensureTailscale] }
    );

    // Extract the MagicDNS hostname (e.g. "my-server.tail12345.ts.net")
    const getTailscaleHostname = new command.remote.Command(
      `${name}-get-tailscale-hostname`,
      {
        connection: rootConn,
        create: `tailscale status --json | python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))"`,
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [getTailscaleIp] }
    );

    // Configure Tailscale Serve for HTTPS → Nginx on localhost:80
    const addTailscaleServe = new command.remote.Command(
      `${name}-tailscale-serve-https`,
      {
        connection: rootConn,
        create: `
  # Wait for Tailscale fully connected
  for i in $(seq 1 30); do
    STATE=$(timeout 5 tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('BackendState',''))" 2>/dev/null)
    if [ "$STATE" = "Running" ]; then
      echo "Tailscale running"
      break
    fi
    echo "Waiting for tailscale Running... ($i/30, state=$STATE)"
    sleep 2
  done
  [ "$STATE" = "Running" ] || { echo "Tailscale not in Running state: $STATE"; exit 1; }

  # Apply serve config (modern v1.52+ syntax)
  timeout 20 tailscale serve --bg --yes http://127.0.0.1:80 || true
  sleep 2

  # Verify serve config was applied
  tailscale serve status 2>/dev/null | grep -qE "(127.0.0.1:80|:80)" || { echo "Serve config missing"; exit 1; }
  echo "Tailscale serve configured"
`,
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [ensureTailscale, getTailscaleHostname] }
    );

    // Allow Tailscale direct WireGuard peer connections
    const addTailscaleUdpUfwRule = new command.remote.Command(
      `${name}-add-tailscale-udp-ufw-rule`,
      {
        connection: rootConn,
        create: "ufw allow 41641/udp",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [getTailscaleIp] }
    );

    const addHttpUfwRule = new command.remote.Command(
      `${name}-add-http-ufw-rule`,
      {
        connection: rootConn,
        create: "ufw allow in on tailscale0 to any port 80 proto tcp",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [addTailscaleServe, addTailscaleUdpUfwRule] }
    );

    this.tailscaleIp = getTailscaleIp.stdout;
    this.tailscaleHostname = getTailscaleHostname.stdout;
    this.completed = addHttpUfwRule.stdout;

    this.registerOutputs({
      tailscaleIp: this.tailscaleIp,
      tailscaleHostname: this.tailscaleHostname,
      completed: this.completed,
    });
  }
}
