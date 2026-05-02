export const CITADEL_PORT = 3333;
export const CITADEL_VERSION = "0.1.0";
// Citadel binary from public GitHub fork. To use your own, replace URL + SHA256.
// Upstream: TryMightyAI/citadel, TryMightyAI/citadel-guard-openclaw
export const CITADEL_BINARY_URL =
  "https://github.com/SoftwareStartups/citadel/releases/download/v0.1.0/citadel-linux-amd64";
export const CITADEL_BINARY_SHA256 =
  "b9e45e156b5791161bacfe660819aaa5c717506d0eabe52dc564e99c9dafca0b";
export const CITADEL_PLUGIN_VERSION = "0.2.2";
export const CITADEL_PLUGIN_URL =
  "https://github.com/SoftwareStartups/citadel-guard-openclaw/releases/download/v0.2.2/mightyai-citadel-guard-openclaw-0.2.2.tgz";
export const CITADEL_PLUGIN_SHA256 =
  "aa3b8d00b70e6968ae65517a9af9d835fc9b15379f2b7053253305534b180726";
export const OPENCLAW_VERSION = "2026.4.27";
export const GATEWAY_PORT = 18789;
export const DEFAULT_MODEL = "openrouter/minimax/minimax-m2.7";
export const WORKSPACE_PATH = "/home/openclaw/.openclaw/workspace-main";
export const OPENCLAW_BIN = "/home/openclaw/.local/bin/openclaw";
export const NODEJS_MAJOR_VERSION = 22;
export const BUN_VERSION = "1.3.13";

// Context & memory optimization tuning parameters
// Ref: https://docs.openclaw.ai/gateway/configuration-reference
// Ref: https://docs.openclaw.ai/reference/memory-config
export const COMPACTION_SOFT_THRESHOLD_TOKENS = 40000;
export const SESSION_ROTATE_BYTES = "100mb";
export const MAX_CONCURRENT_AGENTS = 6;
export const SUBAGENT_MAX_CONCURRENT = 8;
