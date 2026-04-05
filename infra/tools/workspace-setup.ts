import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { join } from "path";
import { ConnectionArgs } from "../types";
import { OPENCLAW_BIN, WORKSPACE_PATH } from "../config/constants";

export interface WorkspaceSetupArgs {
  openclawConnection: ConnectionArgs;
  workspaceSshPrivateKey: pulumi.Input<string>;
  workspaceRepo: pulumi.Input<string>;
  serverId: pulumi.Input<number>;
}

export class WorkspaceSetup extends pulumi.ComponentResource {
  public readonly completed: pulumi.Output<string>;

  constructor(name: string, args: WorkspaceSetupArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:component:WorkspaceSetup", name, {}, opts);

    const conn = args.openclawConnection;

    const workspaceSetup = new command.remote.Command(
      `${name}-workspace-setup`,
      {
        connection: conn,
        triggers: [args.serverId],
        create: pulumi.interpolate`
set -euo pipefail

# --- SSH deploy key ---
mkdir -p ~/.ssh
cat > ~/.ssh/openclaw_workspace <<'KEYEOF'
${args.workspaceSshPrivateKey}
KEYEOF
chmod 600 ~/.ssh/openclaw_workspace

# SSH config: host alias so this key is used only for this repo
grep -qF 'Host github.com-openclaw-workspace' ~/.ssh/config 2>/dev/null || cat >> ~/.ssh/config <<'SSHEOF'

Host github.com-openclaw-workspace
  HostName github.com
  User git
  IdentityFile ~/.ssh/openclaw_workspace
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
SSHEOF
chmod 600 ~/.ssh/config

REMOTE="git@github.com-openclaw-workspace:${args.workspaceRepo}.git"

# Set git identity for auto-sync commits (needed in both clone and init paths)
git config --global user.email "openclaw@localhost"
git config --global user.name "OpenClaw"

# Check if the repo already has commits
if git ls-remote "$REMOTE" HEAD 2>/dev/null | grep -q HEAD; then
  # --- Non-empty repo: clone or pull existing workspace ---
  if [ -d ${WORKSPACE_PATH}/.git ]; then
    git -C ${WORKSPACE_PATH} pull origin main
  else
    git clone "$REMOTE" ${WORKSPACE_PATH}
    git -C ${WORKSPACE_PATH} branch -M main
  fi
  # Fill any missing bootstrap files without overwriting existing ones
  ${OPENCLAW_BIN} setup --workspace ${WORKSPACE_PATH}
else
  # --- Empty repo: seed with openclaw onboarding, then push ---
  ${OPENCLAW_BIN} setup --workspace ${WORKSPACE_PATH}

  cd ${WORKSPACE_PATH}
  git init -b main
  git branch -M main

  cat > .gitignore <<'GIEOF'
.env
**/*.key
**/*.pem
**/secrets*
.DS_Store
GIEOF

  git remote set-url origin "$REMOTE" 2>/dev/null || git remote add origin "$REMOTE"
  git add -A
  git diff --cached --quiet || git commit -m "Add agent workspace"
  git push -u origin main
fi
`,
      },
      { parent: this }
    );

    // Workspace sync timer — daily auto-commit+push at 4AM UTC
    const copyWorkspaceSyncTimer = new command.remote.CopyToRemote(
      `${name}-copy-workspace-sync-timer`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../assets/services/workspace-sync.timer")
        ),
        remotePath: "/home/openclaw/.config/systemd/user/workspace-sync.timer",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [workspaceSetup] }
    );

    const copyWorkspaceSyncService = new command.remote.CopyToRemote(
      `${name}-copy-workspace-sync-service`,
      {
        connection: conn,
        source: new pulumi.asset.FileAsset(
          join(__dirname, "../assets/services/workspace-sync.service")
        ),
        remotePath: "/home/openclaw/.config/systemd/user/workspace-sync.service",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [workspaceSetup] }
    );

    const enableWorkspaceSync = new command.remote.Command(
      `${name}-enable-workspace-sync`,
      {
        connection: conn,
        create:
          "systemctl --user daemon-reload && systemctl --user enable --now workspace-sync.timer",
        triggers: [args.serverId],
      },
      { parent: this, dependsOn: [copyWorkspaceSyncTimer, copyWorkspaceSyncService] }
    );

    this.completed = enableWorkspaceSync.stdout;

    this.registerOutputs({
      completed: this.completed,
    });
  }
}
