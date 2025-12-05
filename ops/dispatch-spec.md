# Dispatch Specification

Command-line dispatcher for @jeesty/ops functions.

## Entry Points

Each command family has a `.cmd` launcher in the project root:

```
deploy.cmd   →  ops/src/dispatch.ts deploy ...
testenv.cmd  →  ops/src/dispatch.ts testenv ...
test.cmd     →  ops/src/dispatch.ts test ...
```

## Dispatcher Responsibilities

1. **Change to project root** - Always `cd` to the directory containing `.jeestyops/config.json`
2. **Load config once** - Read `.jeestyops/config.json`
3. **Parse CLI args** - Convert to key/value object (see Argument Parsing below)
4. **Lookup command in registry** - Find the registered command schema
5. **Extract config values** - Use schema to pull needed values from config
6. **Merge and override** - CLI params override config values with same name
7. **Provide logger** - Create a `log()` function, add to params
8. **Call function** - Invoke the registered function with merged params
9. **Handle errors** - Wrap in try/catch, print human-readable messages
10. **Exit codes** - `process.exit(0)` on success, `process.exit(1)` on error
11. **Help** - Show human-readable help with `-help` or `--help`

## Command Registry

All dispatchable commands register themselves in a central `opsRegistry`. The registry "knows nothing" - each command fully describes itself.

### Registry Structure

```typescript
interface CommandRegistration {
  // Command identification
  group: string;                    // "deploy", "testenv", "test"
  flag: string;                     // "quick", "stop", "spawn"
  
  // The function to call
  fn: (params: Record<string, unknown>) => Promise<unknown> | unknown;
  
  // Parameter declaration: maps param names to config paths
  // - Non-empty string: pull from config at that path
  // - Empty string "": CLI-only param, no config source
  paramMap: Record<string, string>;  // { paramName: "config.path.here" }
  
  // Help text
  description: string;              // Short description for help
  examples?: string[];              // Example usages
}

// The registry itself
const opsRegistry: Map<string, CommandRegistration> = new Map();

// Key format: "group:flag" e.g. "deploy:quick", "testenv:spawn"
```

### Registration Example

All registrations are centralized in `dispatch-registry.ts` - the wiring knowledge is in one place,
while the functions themselves stay pure (know nothing about dispatch).

```typescript
// dispatch-registry.ts

import { registerOpCommand } from "./op-registry.js";
import { deployQuick } from "./deploy-quick.js";
import { stopService, startService } from "./service-control.js";

registerOpCommand({
  group: "deploy",
  flag: "quick",
  fn: deployQuick,
  paramMap: {
    // Config-sourced
    projectRoot: "projectRoot",
    include: "deployQuick.include",
    exclude: "deployQuick.exclude",
    endpoint: "deployQuick.endpoint",
    healthCheckPath: "container.healthCheck.path",
    healthCheckExpected: "container.healthCheck.expected",
    port: "container.port",
    authUser: "auth.user",
    authEndpoint: "auth.endpoint",
    passwordEnvVar: "auth.passwordEnvVar",
    // CLI-only (empty = no config source)
    local: "",
    target: "",
    skipSmoke: "",
  },
  description: "Quick deploy (zip + upload + restart)",
  examples: [
    "deploy -quick",
    "deploy -quick -local",
    "deploy -quick -target http://localhost:4000",
  ],
});

registerOpCommand({
  group: "deploy",
  flag: "stop",
  fn: stopService,
  paramMap: {
    region: "aws.region",
    serviceName: "name",
  },
  description: "Pause the App Runner service",
  examples: ["deploy -stop"],
});
```

The pure function knows nothing about dispatch or config:

```typescript
// deploy-quick.ts

export async function deployQuick(params: {
  projectRoot: string;
  include: string[];
  // ... config-sourced params
  local?: boolean;   // CLI-only
  target?: string;   // CLI-only
  skipSmoke?: boolean;
  log: (msg: string) => void;
}): Promise<DeployQuickResult> {
  // Pure function logic - knows nothing about dispatch or config objects
}
```

The `registerOpCommand` function is the only import needed from the registry:

```typescript
// op-registry.ts

export interface CommandRegistration {
  group: string;
  flag: string;
  fn: (params: Record<string, unknown>) => Promise<unknown> | unknown;
  paramMap: Record<string, string>;
  description: string;
  examples?: string[];
}

const opsRegistry = new Map<string, CommandRegistration>();

export function registerOpCommand(reg: CommandRegistration): void {
  opsRegistry.set(`${reg.group}:${reg.flag}`, reg);
}

export function getCommand(group: string, flag: string): CommandRegistration | undefined {
  return opsRegistry.get(`${group}:${flag}`);
}

export function getCommandsForGroup(group: string): CommandRegistration[] {
  return [...opsRegistry.values()].filter(r => r.group === group);
}
```

### Dispatcher Flow

```typescript
async function dispatch(args: string[]): Promise<void> {
  const group = args[0];           // "deploy"
  const parsed = parseArgs(args);  // { quick: true, local: true }
  
  // Find which flag identifies the command
  const flag = findCommandFlag(group, parsed);  // "quick"
  
  // Lookup registration
  const reg = opsRegistry.get(`${group}:${flag}`);
  if (!reg) throw new Error(`Unknown command: ${group} -${flag}`);
  
  // Extract config values using paramMap (skip empty = CLI-only)
  const configValues = extractFromConfig(config, reg.paramMap);
  
  // Merge: config values, then CLI overrides, then logger
  const params = {
    ...configValues,
    ...parsed,
    log: createLogger(),
  };
  
  // Call the function
  await reg.fn(params);
}

function extractFromConfig(
  config: OpsConfig, 
  paramMap: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [paramName, configPath] of Object.entries(paramMap)) {
    if (configPath) {  // Skip empty = CLI-only params
      result[paramName] = getByPath(config, configPath);
    }
  }
  return result;
}
```

### Functions Stay Pure

Functions know nothing about dispatch, config objects, or CLI parsing:

```typescript
// deployQuick receives only what it needs - flat, typed params
async function deployQuick(params: {
  projectRoot: string;
  include: string[];
  exclude: string[];
  endpoint: string;
  port: number;
  authUser: string;
  // ... etc
  local?: boolean;
  target?: string;
  log: (msg: string) => void;
}): Promise<DeployQuickResult> {
  // Function has no idea these came from config + CLI merge
}
```

## Argument Parsing

### Flags (boolean)
A dash or double-dash followed by a name, with no value:
```
-quick        → { quick: true }
--verbose     → { verbose: true }
```

### Key/Value with Equals
A dash or double-dash followed by `key=value`:
```
-port=4000    → { port: "4000" }
--target=http://localhost:4000 → { target: "http://localhost:4000" }
```

### Key/Value with Space
If a token lacks a dash, and the previous token was a key without a value, the token becomes that key's value:
```
-port 4000    → { port: "4000" }
--target http://localhost:4000 → { target: "http://localhost:4000" }
```

### Value Lists
If a param ends in a comma, that comma is always considered a list element separator, and the key's value is made into an array. If the next param starts with a dash, it is an error. Otherwise, the following value is appended to the array.

### Normalization
- Both `-` and `--` prefixes are treated identically
- Keys are normalized (e.g., `-skip-smoke` and `--skipSmoke` could map to same key - TBD)

### Errors
- A value token (no dash) with no preceding key → error
- Unknown flags/keys → warn but continue? or error? (TBD)

## Command Routing

Routing is handled by the registry. The dispatcher:
1. Identifies the group from the first arg (e.g., `deploy`)
2. Scans parsed flags to find which registered command matches
3. Looks up `opsRegistry.get("group:flag")`

### Deploy Commands
```
deploy -quick       → opsRegistry.get("deploy:quick")
deploy -stop        → opsRegistry.get("deploy:stop")
deploy -resume      → opsRegistry.get("deploy:resume")
deploy -status      → opsRegistry.get("deploy:status")
deploy -persist     → opsRegistry.get("deploy:persist")
deploy -full        → opsRegistry.get("deploy:full")   (default if no flag)
deploy -help        → show deploy help (from registry)
```

### Test Environment Commands
```
testenv -spawn      → opsRegistry.get("testenv:spawn")
testenv -remove     → opsRegistry.get("testenv:remove")
testenv -help       → show testenv help
```

### Test Runner Commands (future)
```
test -run name1, name2   → opsRegistry.get("test:run")
test -help               → show test help
```


## Options Object

The dispatcher builds an options object to pass to functions:

```typescript
interface DispatchOptions {
  config: OpsConfig;           // Loaded from .jeestyops/config.json
  log: (msg: string) => void;  // Logging function
  // ... plus all parsed CLI args
}
```

Functions receive this merged object. They should not load config themselves.

## Help Output

Help is generated from the registry. Each command's `description` and `examples` are used.

```
Usage: deploy [options]

Options:
  -quick          Quick deploy (zip + upload + restart)
  -stop           Pause the App Runner service
  -resume         Resume a paused service
  -status         Show current service status
  -persist        Sync data to S3
  -full           Full Docker build + deploy (default)
  -wait           Wait for operation to complete
  -local          Target local dev server
  -verbose, -v    Verbose output
  -help           Show this help

Examples:
  deploy -quick
  deploy -stop
  deploy -status -wait
  deploy -quick -local
```

## File Structure

```
project-root/
  deploy.cmd              # Windows launcher
  testenv.cmd             # Windows launcher
  test.cmd                # Windows launcher (future)
  .jeestyops/config.json  # Config file
  ops/
    src/
      dispatch.ts           # Main dispatcher logic
      dispatch-registry.ts  # All command registrations (wiring knowledge)
      op-registry.ts        # OpCommandRegistry class, registerOpCommand
      parse-args.ts         # CLI argument parser
      
      # Pure function modules (know nothing about dispatch)
      deploy-quick.ts       # deployQuick
      service-control.ts    # stopService, startService, getStatus, waitForService
      remote-admin.ts       # persistRemoteService
      # ... etc
```

## Future Considerations

- Positional arguments (not yet implemented)
- Config override: `-config=path/to/config.json`
- Dry-run mode: `-dry-run` to show what would happen
- Color output control: `-no-color`
- Quiet mode: `-quiet` to suppress non-error output
