# Exa API Key

Used by the Exa native plugin for web search. Exa is the default search provider.

1. Create an account at [exa.ai](https://exa.ai)
2. Go to your dashboard and generate an API key
3. Set the ESC secret:

```bash
pulumi env set openclaw/prod pulumiConfig.openclaw:exaApiKey <YOUR_EXA_KEY> --secret
```
