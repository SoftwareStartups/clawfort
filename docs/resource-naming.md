# Resource Naming

## Stack Names

| Stack | Environment |
| --- | --- |
| `prod` | prod |
| `stg` | staging |

## Base Name

All resources share a base name derived from the project name, stack, and location config.

```typescript
const location = config.require("location");
const baseName = `openclaw-${pulumi.getStack()}-${location}`;
// → "openclaw-prod-nbg1", "openclaw-stg-nbg1"
```

The `location` value is set per stack in `Pulumi.<stack>.yaml`:

```yaml
config:
  openclaw:location: nbg1
```

## Logical Names

### Top-level components

Pass `baseName` directly:

```typescript
new HetznerServer(baseName, ...);
new ServerHardening(baseName, ...);
new TailscaleSetup(baseName, ...);
```

### Child resources

`${name}-<verb>-<noun>` — kebab-case, action-oriented.

```typescript
new Command(`${name}-wait-for-cloud-init`, ...);
new Command(`${name}-write-ssh-config`, ...);
new Command(`${name}-restart-sshd`, ...);
```

In loops, inject the parameter:

```typescript
new Command(`${name}-install-${tool.name}-binary`, ...);
// → "openclaw-prod-nbg1-install-gog-binary"
```

### ComponentResource type strings

`custom:component:PascalCase` — never change, it destroys all children.

```typescript
super("custom:component:ServerHardening", name, {}, opts);
```

## Physical Names

Hetzner server and firewall names must be globally unique within a project. Do not set `name` explicitly — use auto-naming to append a random suffix.

Configure in `Pulumi.<stack>.yaml`:

```yaml
config:
  pulumi:autonaming:
    pattern: "${name}-${alphanum(6)}"
```

This produces physical names like `openclaw-prod-nbg1-a3f2bc` and `openclaw-prod-nbg1-firewall-k8m2xp`.

SSH keys are not required to be unique. Set the physical name explicitly:

```typescript
new hcloud.SshKey(`${name}-deploy`, { name: `${name}-deploy` });
```

## Stack Exports

Concise `camelCase`, no redundant suffixes.

```typescript
export const ipv4Address = server.ipv4Address;
export const serverId = server.serverId;
export const tailscaleIp = tailscale.tailscaleIp;
export const gatewayToken = appStack.gatewayToken;
```

## Reference

| Resource | Logical Name | Physical Name |
| --- | --- | --- |
| Top-level component | `openclaw-<stack>-<location>` | — |
| `hcloud.Server` | `${name}` | auto: `${name}-${alphanum(6)}` |
| `hcloud.Firewall` | `${name}-firewall` | auto: `${name}-firewall-${alphanum(6)}` |
| `hcloud.SshKey` | `${name}-deploy` | `${name}-deploy` |
| `remote.Command` | `${name}-<verb>-<noun>` | — |
| `remote.Command` (loop) | `${name}-<verb>-${param}-<noun>` | — |
| Component type string | `custom:component:PascalCase` | — |
| Stack exports | `camelCase` | — |
