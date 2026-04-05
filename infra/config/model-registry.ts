export interface ModelDefinition {
  /** Full OpenClaw model ID including provider prefix */
  id: string;
  /** Short human-readable alias */
  alias: string;
}

export const models = [
  { id: "openrouter/openrouter/auto", alias: "auto" },
  { id: "openrouter/anthropic/claude-haiku-4.5", alias: "haiku" },
  { id: "openrouter/anthropic/claude-opus-4.6", alias: "opus" },
  { id: "openrouter/anthropic/claude-sonnet-4.6", alias: "sonnet" },
  { id: "openrouter/google/gemini-2.5-flash-lite", alias: "flash-lite" },
  { id: "openrouter/google/gemini-3-flash-preview", alias: "gemini-flash" },
  { id: "openrouter/google/gemini-3.1-pro-preview", alias: "gemini-pro" },
  { id: "openrouter/meta-llama/llama-4-maverick", alias: "llama" },
  { id: "openrouter/minimax/minimax-m2.7", alias: "minimax" },
  { id: "openrouter/mistralai/codestral-2508", alias: "codestral" },
  { id: "openrouter/mistralai/mistral-large", alias: "mistral-large" },
  { id: "openrouter/mistralai/mistral-medium-3.1", alias: "mistral-medium" },
  { id: "openrouter/mistralai/mistral-small-3.2-24b-instruct", alias: "mistral-small" },
  { id: "openrouter/moonshotai/kimi-k2-thinking", alias: "kimi-think" },
  { id: "openrouter/moonshotai/kimi-k2.5", alias: "kimi" },
  { id: "openrouter/qwen/qwen3-235b-a22b", alias: "qwen" },
] as const satisfies readonly ModelDefinition[];

const modelsList: ModelDefinition[] = [...models];

export function allModels(): ModelDefinition[] {
  return modelsList;
}
