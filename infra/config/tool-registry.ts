export interface BinaryTool {
  type: "binary";
  name: string;
  osUser: string;
  binaryUrl: string;
  binaryUrlArm64?: string;
  version?: string;
  sha256?: string;
  sha256Arm64?: string;
  archiveBinaryName?: string;
  exposeViaMcp: boolean;
  commandDeny?: string[];
  secrets: { envVar: string; configKey: string }[];
  egressDomains: string[];
  sharedDir?: string;
  writablePaths?: string[];
  configBundle?: { configKey: string };
}

export interface NpmTool {
  type: "npm";
  name: string;
  osUser: string;
  npmPackage: string;
  version?: string;
  exposeViaMcp: boolean;
  commandDeny?: string[];
  secrets: { envVar: string; configKey: string }[];
  egressDomains: string[];
  sharedDir?: string;
  writablePaths?: string[];
}

export interface HttpTool {
  type: "http";
  name: string;
  urlTemplate: string;
  configKey: string;
  exposeViaMcp: true;
}

export type ToolDefinition = BinaryTool | NpmTool | HttpTool;

export const tools = [
  {
    type: "binary",
    name: "gog",
    osUser: "gog-user",
    binaryUrl:
      "https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_amd64.tar.gz",
    binaryUrlArm64:
      "https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_arm64.tar.gz",
    version: "0.12.0",
    sha256: "a03fccbd67ea2e59a26a56e92de8918577f4bebe4b2f946823419777827cdab2",
    sha256Arm64: "d7f20494d7eb0e8716631853d055ccbb368c7b81cb8165f55b45884bccb67b4b",
    archiveBinaryName: "gog",
    exposeViaMcp: false,
    secrets: [{ envVar: "GOG_KEYRING_PASSWORD", configKey: "gogKeyringPassword" }],
    egressDomains: ["oauth2.googleapis.com", "www.googleapis.com"],
    writablePaths: [".config/gogcli"],
    configBundle: { configKey: "gogConfigBundle" },
  },
] as const satisfies readonly ToolDefinition[];

const toolsList: ToolDefinition[] = [...tools];

export function binaryTools(): BinaryTool[] {
  return toolsList.filter((t): t is BinaryTool => t.type === "binary");
}

export function npmTools(): NpmTool[] {
  return toolsList.filter((t): t is NpmTool => t.type === "npm");
}

export function stdioTools(): (BinaryTool | NpmTool)[] {
  return toolsList.filter(
    (t): t is BinaryTool | NpmTool => t.type === "binary" || t.type === "npm"
  );
}

export function httpTools(): HttpTool[] {
  return toolsList.filter((t): t is HttpTool => t.type === "http");
}

export function stdioMcpTools(): (BinaryTool | NpmTool)[] {
  return stdioTools().filter((t) => t.exposeViaMcp);
}
