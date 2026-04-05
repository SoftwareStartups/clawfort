---
name: pulumi
version: 2.0.0
description: Pulumi TypeScript patterns and ESC reference. Covers Output handling, resource options, ESC CLI/YAML, resource transforms, and dynamic providers. For project-specific patterns (components, triggers, connections), see infra/CLAUDE.md.
---

# Pulumi Reference

Project-specific patterns (ComponentResource structure, triggers, connections, deployment phases) are in `infra/CLAUDE.md`. Coding rules (no resources in apply, parent:this, secrets, aliases, etc.) are in `.claude/rules/pulumi-guidelines.md`. This skill covers general Pulumi knowledge beyond those files.

## Output Handling

```typescript
// String interpolation with Outputs
const url = pulumi.interpolate`https://${hostname}:${port}`;

// Simple concatenation
const name = pulumi.concat("prefix-", resource.id, "-suffix");

// Combine multiple outputs
const combined = pulumi.all([a.id, b.arn]).apply(([id, arn]) => ({ id, arn }));

// Transform a single output (NOT for creating resources — only data transforms)
const upper = bucket.id.apply(id => id.toUpperCase());

// Mark a value as secret
const secret = pulumi.secret(someValue);
```

## Resource Options

| Option | Purpose |
|--------|---------|
| `parent` | Set parent for hierarchy (always `this` in components) |
| `dependsOn` | Explicit ordering when no implicit Output dependency exists |
| `protect` | Prevent accidental deletion |
| `aliases` | Preserve identity when renaming or reparenting resources |
| `ignoreChanges` | Skip drift on specific properties |
| `replaceOnChanges` | Force replacement when a property changes |
| `deleteBeforeReplace` | Delete old resource before creating replacement |
| `customTimeouts` | Override create/update/delete timeouts |
| `deletedWith` | Skip delete when parent is deleted (e.g. K8s namespace) |
| `retainOnDelete` | Keep cloud resource when removed from Pulumi state |
| `replaceWith` | Cascade replacement to dependent resources (v3.207+) |
| `hooks` | Lifecycle callbacks: `beforeCreate`, `afterCreate` |
| `replacementTrigger` | Force replacement on trigger value change |

## Async Patterns

```typescript
// Top-level await via async export
export = async () => {
    const data = await fetchExternalData();
    const resource = new hcloud.Server("srv", { name: data.name });
    return { serverId: resource.id };
};
```

## Configuration Typing

```typescript
interface DbConfig { host: string; port: number; name: string }
const config = new pulumi.Config("myapp");
const db = config.requireObject<DbConfig>("database");
const secret = config.requireSecret("apiKey");
```

## ESC CLI Reference

All environment commands use 3-part names: `org/project/env`.

```bash
pulumi env init <org>/<project>/<env>                    # Create environment
pulumi env edit <org>/<project>/<env>                    # Edit in editor
pulumi env set <org>/<project>/<env> <key> <value>       # Set value
pulumi env set <org>/<project>/<env> <key> <val> --secret # Set secret
pulumi env get <org>/<project>/<env>                     # View (secrets hidden)
pulumi env open <org>/<project>/<env>                    # Resolve + reveal secrets
pulumi env run <org>/<project>/<env> -- <cmd>            # Run with env vars
pulumi env version tag <org>/<project>/<env> <tag>       # Tag a version
```

Linking to a stack uses 2-part name (project/env only):

```bash
pulumi config env add <project>/<env>       # Link ESC env to current stack
pulumi config env rm <project>/<env>        # Unlink
pulumi config env ls                        # List linked environments
```

## ESC YAML Structure

```yaml
imports:
  - shared/base-config              # Compose from other environments

values:
  region: us-east-1
  dbPassword:
    fn::secret: super-secure         # Encrypted at rest

  pulumiConfig:                      # Available via pulumi.Config()
    app:region: ${region}
    app:dbPassword: ${dbPassword}

  environmentVariables:              # Injected into shell / pulumi env run
    DB_PASSWORD: ${dbPassword}
```

**Built-in functions**: `fn::secret`, `fn::toBase64`, `fn::fromBase64`, `fn::toJSON`, `fn::fromJSON`, `fn::toString`, `fn::concat`, `fn::split`, `fn::rotate`, `fn::validate`, `fn::final`

## ESC Troubleshooting

| Error | Fix |
|-------|-----|
| "Environment not found" | Check org/project/env spelling; verify access with `pulumi env ls` |
| "Stack can't read values" | Ensure `pulumiConfig` is nested under `values`; verify link with `pulumi config env ls` |
| "Secret decryption failed" | Use `pulumi env open` (not `get`) to resolve secrets |

## Resource Transforms

The modern API is `registerResourceTransform` (replaces deprecated `registerStackTransformation`):

```typescript
pulumi.runtime.registerResourceTransform((args) => {
    if (args.type === "hcloud:index/server:Server") {
        args.props.labels = { ...args.props.labels, managed: "pulumi" };
    }
    return { props: args.props, opts: args.opts };
});
```

Supports async transforms and works with packaged component children (awsx, eks).

## Dynamic Providers

For custom resources without a native Pulumi provider:

```typescript
const provider: pulumi.dynamic.ResourceProvider = {
    async create(inputs) {
        return { id: "my-id", outs: { result: "created" } };
    },
    async update(id, olds, news) {
        return { outs: { result: "updated" } };
    },
    async delete(id, props) { /* cleanup */ },
};

class MyResource extends pulumi.dynamic.Resource {
    public readonly result!: pulumi.Output<string>;
    constructor(name: string, props: {}, opts?: pulumi.CustomResourceOptions) {
        super(provider, name, { result: undefined, ...props }, opts);
    }
}
```
