import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { ConnectionArgs } from "../types";
import { nginxOpenclawConf } from "../templates/nginx/nginx-openclaw.conf";
import { contentHash } from "../config/content-hash";

export interface NginxProxyArgs {
  rootConnection: ConnectionArgs;
  serverId: pulumi.Input<number>;
}

export class NginxProxy extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: NginxProxyArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:NginxProxy", name, {}, opts);

    const rootConn = args.rootConnection;

    const installNginx = new command.remote.Command(
      `${name}-install-nginx`,
      {
        connection: rootConn,
        create: "apt-get install -y nginx",
        triggers: [args.serverId],
      },
      { parent: this }
    );

    const removeDefault = new command.remote.Command(
      `${name}-remove-default`,
      {
        connection: rootConn,
        create: "rm -f /etc/nginx/sites-enabled/default",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [installNginx] }
    );

    const nginxConfig = nginxOpenclawConf();

    const writeNginxConfig = new command.remote.Command(
      `${name}-write-nginx-config`,
      {
        connection: rootConn,
        create: `cat <<'NGINXEOF' > /etc/nginx/sites-available/openclaw\n${nginxConfig}\nNGINXEOF\nln -sf /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/openclaw`,
        triggers: [contentHash(nginxConfig), args.serverId],
      },
      { parent: this, dependsOn: [removeDefault] }
    );

    const reloadNginx = new command.remote.Command(
      `${name}-reload-nginx`,
      {
        connection: rootConn,
        create: "/usr/sbin/nginx -t && systemctl enable nginx && systemctl restart nginx",
        triggers: [contentHash(nginxConfig), args.serverId],
      },
      { parent: this, dependsOn: [writeNginxConfig] }
    );

    this.completed = reloadNginx.stdout;

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
