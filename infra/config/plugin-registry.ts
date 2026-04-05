export interface PluginDefinition {
  name: string;
  configKey: string;
  webSearch?: {
    defaultProvider?: boolean;
    baseUrl?: string;
  };
  webFetch?: {
    baseUrl: string;
    onlyMainContent?: boolean;
    maxAgeMs?: number;
    timeoutSeconds?: number;
  };
}

export const plugins = [
  {
    name: "exa",
    configKey: "exaApiKey",
    webSearch: { defaultProvider: true },
  },
  {
    name: "firecrawl",
    configKey: "firecrawlApiKey",
    webSearch: { baseUrl: "https://api.firecrawl.dev" },
    webFetch: {
      baseUrl: "https://api.firecrawl.dev",
      onlyMainContent: true,
      maxAgeMs: 172800000,
      timeoutSeconds: 60,
    },
  },
] as const satisfies readonly PluginDefinition[];

const pluginsList: PluginDefinition[] = [...plugins];

export function allPlugins(): PluginDefinition[] {
  return pluginsList;
}
