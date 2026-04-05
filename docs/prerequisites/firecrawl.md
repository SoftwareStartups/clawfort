# Firecrawl API Key

Used by the Firecrawl native plugin for web search and web fetching.

1. Create an account at [firecrawl.dev](https://firecrawl.dev)
2. Go to your dashboard and generate an API key
3. Set the ESC secret:

```bash
pulumi env set openclaw/prod pulumiConfig.openclaw:firecrawlApiKey <YOUR_FIRECRAWL_KEY> --secret
```
