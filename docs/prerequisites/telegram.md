# Telegram Bot Token

Used by the Telegram channel for messaging the AI gateway.

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow prompts to name your bot
3. Copy the bot token
4. Set the ESC secret:

```bash
pulumi env set openclaw/prod pulumiConfig.openclaw:telegramBotToken <YOUR_BOT_TOKEN> --secret
```
