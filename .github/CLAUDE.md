# GitHub Actions

## SHA Pinning Policy

All actions pinned to **full 40-character commit SHAs**. Tags are mutable and can be hijacked — SHAs are immutable.

Format: `uses: owner/action@<full-sha>  # v1.2.3`

Find SHA for a version:
```bash
git ls-remote --tags https://github.com/<owner>/<repo>.git 'v4*' | sort -t/ -k3 -V | tail -1
```

Always verify the SHA matches the expected release tag before updating.

## CI Workflow (`workflows/ci.yml`)

- Triggers: push to `main`, all PRs
- Working directory: `infra/`
- Steps: `pnpm install --frozen-lockfile` → `lint` → `format:check` → `typecheck`
- Permissions: `contents: read` only
