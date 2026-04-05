# Prerequisites

Everything you need before running `task up`.

## 1. go-task

Install the [go-task](https://taskfile.dev/installation/) task runner:

```bash
brew install go-task
```

## 2. Pulumi Cloud Account + CLI

1. Create an account at [app.pulumi.com](https://app.pulumi.com) (free tier works)
2. Install the Pulumi CLI:

```bash
brew install pulumi
```

3. Log in:

```bash
pulumi login
```

## 3. SSH Keypair

Generate a dedicated keypair for the Hetzner server:

```bash
task keys:ssh
```

The public key is used in the ESC `sshPublicKey` secret (see step 10).

## 4. Hetzner Account + API Token

1. Create an account at [console.hetzner.cloud](https://console.hetzner.cloud)
2. In your project → **Security → API Tokens**, generate a token with **Read & Write** access
3. Save it for the `HCLOUD_TOKEN` ESC secret (step 10)

## 5. Tailscale Account + Auth Key

1. Create an account at [login.tailscale.com](https://login.tailscale.com)
2. Go to **Settings → Keys → Generate auth key**
3. Enable **Ephemeral** and add a tag (e.g., `tag:server`)
4. Save it for the `tailscaleAuthKey` ESC secret (step 10)

> **Security note:** The auth key is embedded in Hetzner cloud-init user-data,
> which is stored on the hypervisor and retrievable via the Hetzner API. Always
> use an **ephemeral, single-use** key so it becomes invalid after the server
> joins the tailnet. Rotate the key in ESC before each new deployment.
5. Configure the ACL policy in the Tailscale admin console (**Settings → Access Controls**). Copy the hardened ACL from `docs/tailscale-org-setup.jsonc`, which enforces:

   - **Device posture** — only macOS devices running a stable Tailscale build with auto-update enabled can connect. Blocks access from unknown/compromised devices even if they join the Tailnet.
   - **Deny-by-default grants** — only `autogroup:member` (your user devices) can reach `tag:server`. All other traffic is denied.
   - **Tailscale SSH** — targets `tag:server` (not `autogroup:self`, which doesn't match tagged devices). Only the `openclaw` user is allowed; use `sudo` for root access after connecting. The `"action": "check"` mode requires browser-based re-authentication — change to `"accept"` if MFA friction is too high for single-user use.
   To verify after applying: use the **Preview rules** tab in the admin console to check access from your user to `tag:server`. Then run `tailscale ssh openclaw@<hostname>` from your Mac to confirm SSH works.

   See `docs/tailscale-org-setup.jsonc` for the full ACL with comments.

## 6. Tool & Channel API Keys

Set up API keys for each tool and channel. See the individual guides:

- [GOG](prerequisites/gog.md) — Google Calendar CLI
- [Exa](prerequisites/exa.md) — Web search & research
- [Firecrawl](prerequisites/firecrawl.md) — Web crawling
- [Telegram](prerequisites/telegram.md) — Messaging channel

## 7. OpenRouter API Key

1. Create an account at [openrouter.ai](https://openrouter.ai)
2. Go to **Keys** and generate an API key
3. Save it for the `openrouterApiKey` ESC secret (step 10)

## 8. Gemini API Key (for Memory & Embeddings)

OpenClaw's memory system uses vector embeddings for semantic search across past conversations.
We use Google's Gemini `text-embedding-004` model (free tier is sufficient for single-user use).

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **Create API key** and select a Google Cloud project (or create one)
3. Copy the key
4. Save it for the `geminiApiKey` ESC secret (step 10)

> **Why Gemini?** OpenRouter (our LLM proxy) doesn't support embedding requests.
> Gemini's free tier provides generous embedding API access for a single-user gateway.
> OpenClaw auto-detects the provider from environment variables — no additional config needed.

## 9. Generate Gateway Auth Token

```bash
task keys:token
```

Copy the output. Save it for the `gatewayAuthToken` ESC secret (step 10).

## 10. Backup Encryption Keypair

Install [age](https://github.com/FiloSottile/age) (file encryption tool):

```bash
brew install age
```

Generate an age keypair for encrypting server backups:

```bash
task keys:backup
```

1. Store the **private key** (`openclaw_backup.key`) securely offline (password manager, encrypted USB). This is the only way to decrypt backups.
2. Set the **public key** in Pulumi ESC:

```bash
pulumi env set openclaw/prod pulumiConfig.openclaw:agePublicKey <PUBLIC_KEY>
```

3. Delete the local private key file after storing it safely:

```bash
rm openclaw_backup.key
```

> **Why age?** Backups contain `openclaw.json` with secrets. age provides simple,
> auditable encryption with no config. The public key on the server encrypts;
> the private key stays offline with the operator, never on the server or in ESC.

## 11. Create Pulumi ESC Environment

Initialize the ESC environment and populate all secrets:

```bash
pulumi env init openclaw/prod

# SSH keys (private key is multiline — use the task wrapper, not env set directly)
task esc:set-ssh-key

# Tailscale auth key
pulumi env set openclaw/prod pulumiConfig.openclaw:tailscaleAuthKey <YOUR_TAILSCALE_KEY> --secret

# Gateway auth token (output of task keys:token)
pulumi env set openclaw/prod pulumiConfig.openclaw:gatewayAuthToken <YOUR_TOKEN> --secret

# OpenRouter API key
pulumi env set openclaw/prod pulumiConfig.openclaw:openrouterApiKey <YOUR_OPENROUTER_KEY> --secret

# Hetzner API token (injected as env var for the hcloud Pulumi provider)
pulumi env set openclaw/prod environmentVariables.HCLOUD_TOKEN <YOUR_HETZNER_TOKEN> --secret

# Tool secrets — config keys match configKey fields in infra/config/tool-registry.ts
# Add one ESC entry per tool secret (envVar/configKey pairs in tool-registry.ts)
# GOG keyring password
pulumi env set openclaw/prod pulumiConfig.openclaw:gogKeyringPassword <YOUR_GOG_KEYRING_PASSWORD> --secret

# GOG config bundle (base64-encoded config)
pulumi env set openclaw/prod pulumiConfig.openclaw:gogConfigBundle <YOUR_GOG_CONFIG_BUNDLE> --secret

# Exa API key for web search
pulumi env set openclaw/prod pulumiConfig.openclaw:exaApiKey <YOUR_EXA_KEY> --secret

# Firecrawl API key for web crawling
pulumi env set openclaw/prod pulumiConfig.openclaw:firecrawlApiKey <YOUR_FIRECRAWL_KEY> --secret

# Telegram bot token
pulumi env set openclaw/prod pulumiConfig.openclaw:telegramBotToken <YOUR_BOT_TOKEN> --secret

# Telegram user ID (numeric ID of the allowed user — get via @userinfobot)
pulumi env set openclaw/prod pulumiConfig.openclaw:telegramUserId <YOUR_TELEGRAM_USER_ID> --secret

# Gemini API key for memory embeddings (from step 8)
pulumi env set openclaw/prod pulumiConfig.openclaw:geminiApiKey <YOUR_GEMINI_KEY> --secret

# Workspace repo (org/repo format — used by WorkspaceSetup to clone via deploy key)
pulumi env set openclaw/prod pulumiConfig.openclaw:workspaceRepo <YOUR_ORG/YOUR_WORKSPACE_REPO>

# Backup encryption public key (from step 10, not a secret — public key only)
pulumi env set openclaw/prod pulumiConfig.openclaw:agePublicKey <YOUR_AGE_PUBLIC_KEY>
```

Verify secrets are stored:

```bash
pulumi env open openclaw/prod
```

## 12. Workspace Deploy Key (GitHub)

The agent workspace (`~/.openclaw/workspace`) is backed up to a private GitHub repo.
A deploy key allows the server to push non-interactively.

**One-time setup — do this before `task up`:**

1. Generate a dedicated deploy key:

```bash
task keys:workspace
```

1. Add the **public** key to GitHub:
   - Repo: `<your-workspace-repo>` → **Settings → Deploy keys**
   - Title: `openclaw-server-deploy`
   - Enable **Allow write access** ✓
   - Paste the contents of `openclaw_workspace_deploy.pub`

1. Add the **private** key to Pulumi ESC:

```bash
task esc:set-workspace-key
```

1. Clean up local key files (the secret is now in ESC):

```bash
rm openclaw_workspace_deploy openclaw_workspace_deploy.pub
```

> **Why a deploy key?** GitHub deploy keys are scoped to a single repo and support
> write access without exposing a personal access token. The private key lives only
> in Pulumi ESC (encrypted) and on the server (written to `~/.ssh/`, chmod 600).

## 13. Link ESC to Pulumi Stack

The `infra/Pulumi.prod.yaml` already contains:

```yaml
environment:
  - openclaw/prod
```

This injects `pulumiConfig` values into the stack automatically on `pulumi up`.
