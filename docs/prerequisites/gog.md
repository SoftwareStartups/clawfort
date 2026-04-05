# GOG (Google Calendar CLI)

Read-only Google Calendar access via the GOG CLI tool.

## 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Enable the **Google Calendar API**:
   - Navigate to APIs & Services > Library
   - Search for "Google Calendar API" and enable it

## 2. OAuth Credentials

1. Go to APIs & Services > Credentials
2. Click Create Credentials > OAuth client ID
3. Application type: **Desktop app**
4. Download the credentials JSON file

If prompted to configure the OAuth consent screen first:
- User type: External (or Internal for Workspace)
- Add scope: `https://www.googleapis.com/auth/calendar.readonly`
- No need to submit for verification (personal use)

## 3. Local Authentication

Install GOG locally:

```bash
brew install steipete/tap/gogcli
```

Generate a keyring password (save this for step 5):

```bash
export GOG_KEYRING_PASSWORD="$(openssl rand -hex 32)"
echo "Keyring password: $GOG_KEYRING_PASSWORD"
```

Import credentials and authorize with read-only calendar scope. `GOG_KEYRING_PASSWORD` **must** be set (from the previous step) before running `gog auth add` — otherwise tokens go to the OS keychain instead of the portable file-based keyring and won't be included in the config bundle:

```bash
gog auth credentials ~/Downloads/client_secret_*.json
gog auth add your-email@gmail.com --services calendar --readonly
```

This opens a browser for OAuth consent. After approval, verify it works:

```bash
gog calendar calendars --max 3
```

## 4. Create Config Bundle

Package the authenticated config directory as a base64 tarball:

```bash
cd ~/Library/Application\ Support
tar -czf /tmp/gogcli-bundle.tar.gz gogcli/
base64 < /tmp/gogcli-bundle.tar.gz | pbcopy
rm /tmp/gogcli-bundle.tar.gz
```

The bundle is now in your clipboard.

## 5. Set ESC Secrets

```bash
pulumi env set openclaw/prod pulumiConfig.openclaw:gogConfigBundle "<PASTE_BASE64>" --secret
pulumi env set openclaw/prod pulumiConfig.openclaw:gogKeyringPassword "<KEYRING_PASSWORD>" --secret
```

## Access Scope

Only `calendar.readonly` is granted via the `--services calendar --readonly` flags during auth. Write operations (create, update, delete events) are rejected by Google's API even if attempted. The OpenClaw config adds a `byProvider` deny list as defense-in-depth.

## Token Refresh

OAuth refresh tokens are handled automatically by GOG. The server's systemd service allows write access to `~/.config/gogcli/` for token storage updates.

## Revoking Access

To revoke the OAuth token:
1. Go to [Google Account Permissions](https://myaccount.google.com/permissions)
2. Find the OAuth app and remove access
3. Remove the ESC secrets:

```bash
pulumi env rm openclaw/prod pulumiConfig.openclaw:gogConfigBundle
pulumi env rm openclaw/prod pulumiConfig.openclaw:gogKeyringPassword
```
