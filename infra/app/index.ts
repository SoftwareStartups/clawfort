import * as pulumi from "@pulumi/pulumi";
import { readConfig } from "../config";
import { OpenClawStack } from "./app-stack";

const config = readConfig();
const baseName = `openclaw-${pulumi.getStack()}-${config.location}`;

const stack = new OpenClawStack(baseName, config);

export const ipv4Address = stack.ipv4Address;
export const serverId = stack.serverId;
export const tailscaleIp = stack.tailscaleIp;
export const tailscaleHostname = stack.tailscaleHostname;
export const tailscaleUrlWithToken = pulumi.secret(
  pulumi.interpolate`https://${stack.tailscaleHostname}/?token=${config.gatewayAuthToken}`
);
export const gatewayToken = pulumi.secret(config.gatewayAuthToken);
