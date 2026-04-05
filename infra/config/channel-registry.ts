export interface TelegramChannelConfig {
  type: "telegram";
  name: string;
  secrets: { configKey: string; field: string }[];
  dmPolicy: "allowlist" | "pairing";
  groupPolicy: "allowlist" | "disabled";
  streaming?: "partial" | "full";
}

export type ChannelDefinition = TelegramChannelConfig;

export const channels = [
  {
    type: "telegram",
    name: "telegram",
    secrets: [
      { configKey: "telegramBotToken", field: "botToken" },
      { configKey: "telegramUserId", field: "allowFrom" },
    ],
    dmPolicy: "allowlist",
    groupPolicy: "disabled",
    streaming: "partial",
  },
] as const satisfies readonly ChannelDefinition[];

const channelsList: ChannelDefinition[] = [...channels];

export function allChannels(): ChannelDefinition[] {
  return channelsList;
}
