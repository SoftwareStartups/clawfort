import * as pulumi from "@pulumi/pulumi";
import { stdioTools, binaryTools } from "./tool-registry";

export interface OpenClawConfig {
  sshPublicKey: string;
  sshPrivateKey: pulumi.Output<string>;
  tailscaleAuthKey: pulumi.Output<string>;
  gatewayAuthToken: pulumi.Output<string>;
  openrouterApiKey: pulumi.Output<string>;
  geminiApiKey: pulumi.Output<string>;
  telegramBotToken: pulumi.Output<string>;
  telegramUserId: pulumi.Output<string>;
  exaApiKey: pulumi.Output<string>;
  firecrawlApiKey: pulumi.Output<string>;
  workspaceSshPrivateKey: pulumi.Output<string>;
  workspaceRepo: string;
  agePublicKey: string;
  location: string;
  serverType: string;
  toolSecrets: Record<string, pulumi.Output<string>>;
  toolConfigBundles: Record<string, pulumi.Output<string>>;
}

export function readConfig(): OpenClawConfig {
  const config = new pulumi.Config("openclaw");

  const toolSecrets: Record<string, pulumi.Output<string>> = {};
  for (const tool of stdioTools()) {
    for (const s of tool.secrets) {
      toolSecrets[s.configKey] = config.requireSecret(s.configKey);
    }
  }

  const toolConfigBundles: Record<string, pulumi.Output<string>> = {};
  for (const tool of binaryTools()) {
    if (tool.configBundle) {
      toolConfigBundles[tool.name] = config.requireSecret(tool.configBundle.configKey);
    }
  }

  return {
    sshPublicKey: config.require("sshPublicKey"),
    sshPrivateKey: config.requireSecret("sshPrivateKey"),
    tailscaleAuthKey: config.requireSecret("tailscaleAuthKey"),
    gatewayAuthToken: config.requireSecret("gatewayAuthToken"),
    openrouterApiKey: config.requireSecret("openrouterApiKey"),
    geminiApiKey: config.requireSecret("geminiApiKey"),
    telegramBotToken: config.requireSecret("telegramBotToken"),
    telegramUserId: config.requireSecret("telegramUserId"),
    exaApiKey: config.requireSecret("exaApiKey"),
    firecrawlApiKey: config.requireSecret("firecrawlApiKey"),
    workspaceSshPrivateKey: config.requireSecret("workspaceSshPrivateKey"),
    workspaceRepo: config.require("workspaceRepo"),
    agePublicKey: config.get("agePublicKey") ?? "",
    location: config.require("location"),
    serverType: config.get("serverType") ?? "ccx13",
    toolSecrets,
    toolConfigBundles,
  };
}

export * from "./constants";
export * from "./content-hash";
export * from "./tool-registry";
export * from "./channel-registry";
export * from "./agent-registry";
export * from "./plugin-registry";
export * from "./model-registry";
