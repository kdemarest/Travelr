# Jeesty MCP Diagnostic Report

**Date:** December 4, 2025
**Project:** travelr-win64
**Issue:** MCP server fails to start

## Error Message

When Copilot attempts to use any `mcp_jeesty-mcp_*` tool:

```
ERROR while calling tool: MCP server could not be started: Process exited with code 1
```

## Root Cause Found

Running `npx jeesty-mcp` directly reveals the bug:

```
Error: ENOENT: no such file or directory, open 'C:\Users\kende\code\travelr-win64\node_modules\jeesty-mcp\out\package.json'
    at Object.readFileSync (node:fs:440:20)
    at Object.<anonymous> (C:\...\jeesty-mcp\out\mcp-server\index.js:45:35)
```

**The MCP server code (`index.js` line 45) is trying to read `package.json` from the `out/` directory, but it only exists in the package root.**

```
node_modules/jeesty-mcp/
  package.json        ← EXISTS
  out/
    package.json      ← MISSING (but code looks here)
    mcp-server/
      index.js        ← reads "../package.json" (resolves to out/package.json)
```

## Fix Required

In `mcp-server/index.js` line 45, the path resolution for `package.json` is wrong. It should be `../../package.json` instead of `../package.json` (or use a different resolution strategy).

## VS Code Config (Correct)

`~/.vscode/mcp.json`:
```json
{
    "servers": {
        "jeesty-mcp": {
            "type": "stdio",
            "command": "npx",
            "args": ["jeesty-mcp"],
            "env": {
                "JEESTY_WORKSPACE_PATH": "${workspaceFolder}"
            }
        }
    }
}
```

## Environment

- OS: Windows 11
- Node: v24.11.1
- jeesty-mcp: v0.4.2
- VS Code: Restarted after config
