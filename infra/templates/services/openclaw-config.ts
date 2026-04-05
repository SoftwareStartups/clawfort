import {
  GATEWAY_PORT,
  CITADEL_PORT,
  DEFAULT_MODEL,
  WORKSPACE_PATH,
  COMPACTION_SOFT_THRESHOLD_TOKENS,
  SESSION_ROTATE_BYTES,
  MAX_CONCURRENT_AGENTS,
  SUBAGENT_MAX_CONCURRENT,
} from "../../config/constants";
import { stdioMcpTools } from "../../config/tool-registry";
import { allChannels, type ChannelDefinition } from "../../config/channel-registry";
import { allAgents, type AgentDefinition } from "../../config/agent-registry";
import { plugins, allPlugins } from "../../config/plugin-registry";
import { allModels } from "../../config/model-registry";
import { generateMcpServersJson } from "../../tools/tool-generators";

type PluginConfigKey = (typeof plugins)[number]["configKey"];
type ChannelSecretKey = ChannelDefinition["secrets"][number]["configKey"];

export type OpenClawConfigSecrets = {
  authToken: string;
} & Record<PluginConfigKey | ChannelSecretKey, string>;

export interface OpenClawConfigRuntime {
  tailscaleHostname: string;
}

function buildGatewayConfig(
  secrets: OpenClawConfigSecrets,
  runtime: OpenClawConfigRuntime,
  port: number
): Record<string, unknown> {
  return {
    mode: "local",
    bind: "loopback",
    port,
    trustedProxies: ["127.0.0.1"],
    controlUi: {
      enabled: true,
      allowedOrigins: [`https://${runtime.tailscaleHostname}`],
    },
    auth: { mode: "token", token: secrets.authToken },
  };
}

function buildPluginConfig(
  citadelPort: number,
  secrets: OpenClawConfigSecrets
): Record<string, unknown> {
  const entries: Record<string, unknown> = {
    "citadel-guard-openclaw": {
      enabled: true,
      config: { endpoint: `http://localhost:${citadelPort}` },
    },
  };

  // NOTE: only plugins with webSearch are added to entries. If a fetch-only
  // plugin is added in the future, broaden this filter to include webFetch.
  for (const plugin of allPlugins()) {
    if (!plugin.webSearch) continue;
    const config: Record<string, unknown> = {
      webSearch: {
        apiKey: secrets[plugin.configKey],
        ...(plugin.webSearch.baseUrl && { baseUrl: plugin.webSearch.baseUrl }),
      },
    };
    entries[plugin.name] = { enabled: true, config };
  }

  return {
    allow: ["citadel-guard-openclaw"],
    load: { paths: ["~/.openclaw/extensions/citadel-guard-openclaw"] },
    entries,
  };
}

// Context & memory optimization settings based on:
// - Article: https://medium.com/@creativeaininja/how-to-optimize-openclaw-memory-concurrency-and-context-that-actually-works-84690c2de3d7
// - Official docs: https://docs.openclaw.ai/gateway/configuration-reference
// - Memory docs: https://docs.openclaw.ai/reference/memory-config
function buildAgentConfig(agentDefs: AgentDefinition[], model: string): Record<string, unknown> {
  const list = agentDefs.map((agent) => ({
    id: agent.id,
    default: agent.default ?? false,
    workspace: agent.workspacePath,
  }));

  const modelsMap: Record<string, Record<string, unknown>> = {};
  for (const m of allModels()) {
    modelsMap[m.id] = {};
  }

  return {
    defaults: {
      model: { primary: model },
      models: modelsMap,
      workspace: WORKSPACE_PATH,
      maxConcurrent: MAX_CONCURRENT_AGENTS,
      subagents: { maxConcurrent: SUBAGENT_MAX_CONCURRENT },
      contextPruning: {
        mode: "cache-ttl",
        ttl: "6h",
        keepLastAssistants: 3,
      },
      memorySearch: {
        enabled: true,
        provider: "gemini",
        sources: ["memory", "sessions"],
        experimental: { sessionMemory: true },
        query: {
          hybrid: {
            enabled: true,
            vectorWeight: 0.7,
            textWeight: 0.3,
            candidateMultiplier: 4,
          },
        },
      },
      compaction: {
        mode: "default",
        memoryFlush: {
          enabled: true,
          softThresholdTokens: COMPACTION_SOFT_THRESHOLD_TOKENS,
          prompt:
            "Distill to memory/daily/YYYY-MM-DD.md. Capture decisions, lessons, action items, blockers. Skip routine exchanges. If nothing worth storing: NO_FLUSH",
          systemPrompt: "Extract only durable knowledge. No fluff, no summaries of routine work.",
        },
      },
      sandbox: {
        mode: "non-main",
        docker: {
          network: "none",
          readOnlyRoot: true,
          capDrop: ["ALL"],
          pidsLimit: 256,
          memory: "1g",
          cpus: 1,
          user: "1000:1000",
        },
        browser: {
          enabled: true,
          image: "openclaw-sandbox-browser:bookworm-slim",
          network: "openclaw-sandbox-browser",
          cdpPort: 9222,
          headless: true,
          autoStart: true,
          autoStartTimeoutMs: 12000,
          allowHostControl: false,
        },
      },
    },
    list,
  };
}

function buildChannelConfig(
  secrets: OpenClawConfigSecrets,
  channelDefs: ChannelDefinition[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const ch of channelDefs) {
    if (ch.type === "telegram") {
      const botTokenSecret = ch.secrets.find((s) => s.field === "botToken");
      const allowFromSecret = ch.secrets.find((s) => s.field === "allowFrom");
      result[ch.name] = {
        enabled: true,
        botToken: botTokenSecret ? secrets[botTokenSecret.configKey] : undefined,
        dmPolicy: ch.dmPolicy,
        groupPolicy: ch.groupPolicy,
        allowFrom: allowFromSecret ? [secrets[allowFromSecret.configKey]] : [],
        groups: { "*": { enabled: false } },
        ...(ch.streaming && { streaming: ch.streaming }),
      };
    }
  }
  return result;
}

function buildWebToolsConfig(secrets: OpenClawConfigSecrets): Record<string, unknown> {
  const search: Record<string, unknown> = {};
  const fetch: Record<string, unknown> = {};

  for (const plugin of allPlugins()) {
    if (plugin.webSearch?.defaultProvider) {
      search.provider = plugin.name;
    }
    if (plugin.webFetch) {
      fetch[plugin.name] = {
        apiKey: secrets[plugin.configKey],
        baseUrl: plugin.webFetch.baseUrl,
        onlyMainContent: plugin.webFetch.onlyMainContent,
        maxAgeMs: plugin.webFetch.maxAgeMs,
        timeoutSeconds: plugin.webFetch.timeoutSeconds,
      };
    }
  }

  return { search, fetch };
}

function buildToolsConfig(secrets: OpenClawConfigSecrets): Record<string, unknown> {
  return {
    profile: "coding",
    byProvider: {
      gog: {
        deny: [
          "calendar create",
          "calendar update",
          "calendar delete",
          "calendar subscribe",
          "calendar alias",
        ],
      },
    },
    exec: {
      timeoutSec: 1800,
      backgroundMs: 10000,
      notifyOnExit: true,
    },
    loopDetection: {
      enabled: true,
      historySize: 30,
      warningThreshold: 10,
      criticalThreshold: 20,
    },
    web: buildWebToolsConfig(secrets),
  };
}

function buildSkillsConfig(): Record<string, unknown> {
  return {
    allowBundled: ["_none"],
  };
}

export function openclawConfig(
  secrets: OpenClawConfigSecrets,
  runtime: OpenClawConfigRuntime
): Record<string, unknown> {
  return {
    gateway: buildGatewayConfig(secrets, runtime, GATEWAY_PORT),
    mcp: { servers: generateMcpServersJson(stdioMcpTools()) },
    plugins: buildPluginConfig(CITADEL_PORT, secrets),
    agents: buildAgentConfig(allAgents(), DEFAULT_MODEL),
    channels: buildChannelConfig(secrets, allChannels()),
    commands: {
      native: "auto",
      nativeSkills: "auto",
      restart: true,
      ownerDisplay: "raw",
    },
    tools: buildToolsConfig(secrets),
    skills: buildSkillsConfig(),
    session: {
      maintenance: {
        mode: "enforce",
        rotateBytes: SESSION_ROTATE_BYTES,
        pruneAfter: "30d",
      },
      reset: {
        idleMinutes: 120,
      },
    },
  };
}
