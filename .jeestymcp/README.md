# Jeesty MCP Configuration

This directory configures the [jeesty-mcp](https://www.npmjs.com/package/jeesty-mcp) server for this project.

## Files

| File | Purpose |
|------|---------|
| `config.json` | Tool, prompt, and resource definitions |
| `instructions.md` | AI instructions template (uses mustache variables) |
| `README.md` | This file - configuration documentation |

## config.json Reference

### Full Structure

```json
{
    "instructionsFile": "instructions.md",
    "tools": {
        "my-tool": {
            "usage": "Description shown to the AI",
            "when": "Guidance on when to use this tool",
            "cmd": "shell command to run",
            "params": {
                "paramName": {
                    "type": "string",
                    "description": "Help text for this parameter",
                    "required": true
                }
            }
        }
    },
    "prompts": {
        "my-prompt": {
            "description": "What this prompt does",
            "template": "Prompt text with {{variable}} placeholders"
        }
    },
    "resources": {
        "myapp://endpoint": {
            "description": "What this resource provides",
            "url": "http://localhost:3000/api/endpoint",
            "mimeType": "application/json"
        }
    }
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `instructionsFile` | string | Path to instructions file (default: `instructions.md`) |
| `tools` | object | Custom tools the AI can call |
| `prompts` | object | Reusable prompt templates |
| `resources` | object | HTTP resources the AI can read |

### Tool Fields

| Field | Type | Description |
|-------|------|-------------|
| `usage` | string | **Required.** Description shown to the AI |
| `when` | string | Guidance on when to use this tool |
| `cmd` | string | Shell command to execute (runs in project root) |
| `module` | string | Path to JS/TS module with `run()` export (alternative to `cmd`) |
| `params` | object | Parameter definitions |

### Parameter Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"string"`, `"number"`, or `"boolean"` |
| `description` | string | Help text shown to the AI |
| `required` | boolean | Whether the parameter is mandatory |
| `addToCmdWithoutKey` | boolean | Pass as positional arg instead of `--key=value` |
| `flag` | string | For booleans: the exact flag to add when true (e.g., `"-prod"`) |

### How Parameters Become Command-Line Arguments

When the AI calls a tool with JSON params, they're converted to CLI args:

| Config | AI Param | Resulting CLI |
|--------|----------|---------------|
| `"addToCmdWithoutKey": true` | `{"endpoint": "/ping"}` | `cmd /ping` |
| (default) | `{"user": "bob"}` | `cmd --user=bob` |
| `"flag": "-prod"` | `{"prod": true}` | `cmd -prod` |
| `"flag": "-prod"` | `{"prod": false}` | `cmd` (flag omitted) |

**Example:** The `post` tool with `{"endpoint": "/ping", "prod": true, "deploybot": true}` runs:
```
npx tsx scripts/post.ts /ping -prod -deploybot
```

### Tool Modes

**Command mode** (`cmd`): Spawns a shell and runs the command
```json
{
    "usage": "Run the test suite",
    "cmd": "npm test",
    "when": "Use when the user asks to run tests"
}
```

**Module mode** (`module`): Imports a JS/TS module and calls its `run()` function
```json
{
    "usage": "Fetch data from a URL",
    "module": "scripts/fetcher.js",
    "params": {
        "url": { "type": "string", "required": true }
    }
}
```

Module mode is faster (no shell overhead). The module must export:
```typescript
export async function run(params: Record<string, unknown>): Promise<string | object>
```

## instructions.md

The instructions file uses mustache templates that are auto-populated:

| Variable | Description |
|----------|-------------|
| `{{McpServerName}}` | The server name (`jeesty-mcp`) |
| `{{McpVersion}}` | The installed package version |
| `{{McpToolUsage}}` | Auto-generated tool documentation from config.json |
| `{{McpToolWhen}}` | Auto-generated "when to use" guidance |

Add project-specific notes in the "Project Notes" section.

## When to Restart the MCP Server

**No restart needed** for:
- Editing `config.json` (tools, prompts, resources) — changes are hot-reloaded
- Editing `instructions.md` — re-read on each request

**Restart required** for:
- Updating the jeesty-mcp npm package (`npm update jeesty-mcp`)
- First-time setup after running `npx jeesty-mcp init`

To restart:
- **Quick**: `Ctrl+Shift+P`, type `reload`, press Enter (reloads VS Code window)
- **Targeted**: `Ctrl+Shift+P` → `MCP: List Servers` → click restart icon on jeesty-mcp

## Fresh Install

To reset `.jeestymcp/` to defaults (overwrites existing files):

```bash
npx jeesty-mcp init --force
```

## Verifying It Works

Ask the AI: "ping the jeesty mcp server" — it should respond with "pong".
