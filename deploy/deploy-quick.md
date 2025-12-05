# Quick Deploy Deployment

Quick Deploy allows deploying code changes without rebuilding the Docker container. It's much faster than a full deploy (~30 seconds vs ~5 minutes).

## How It Works

### Production Flow (`node deploy --quick`)

1. **deploy.js** creates a zip of source files using `scripts/create-deploy-zip.ts`, zipping to `dataTemp/quick-deploy-outbound.zip`
2. **deploy.js** computes MD5 of zip, authenticates as `deploybot`, POSTs zip with `X-Content-MD5` header to `/admin/deploy-quick`
3. **Server** receives zip, computes MD5, validates against header (reject if mismatch)
4. **Server** saves zip to `dataTemp/quick-deploy-inbound.zip`
5. **Server** runs in-memory extract on the whole zip to validate integrity
6. **Server** if success, spawns `scripts/relaunch.ts --log=<path> --md5=<hash>` as detached process
7. **Server** responds with `{ ok, logFile, fileCount, ... }` then shuts down gracefully
8. **deploy.js** if failure reported it emits that. It emits the name of the relaunch logfile on the server
9. **relaunch.ts** logs everything to the specified log file
10. **relaunch.ts** waits for server to exit (PID file disappears)
11. **relaunch.ts** reads zip, computes MD5, validates against `--md5` argument (exit if mismatch)
12. **relaunch.ts** extracts zip in memory (no CLI), writes each file directly to app directory, verifying each write succeeded
13. **relaunch.ts** runs `npm install` if package.json changed
14. **relaunch.ts** runs `npm run build` to recompile TypeScript
15. **relaunch.ts** starts the server, and exits
16. **deploy.js** polls `/ping`, showing time in 10 second intervals, until server responds. Confirms success.
17. **deploy.js** if pings timeout after 2 minutes, reports failure. Recovery: run `node deploy` for full rebuild.

### Test Flow (`scripts/test-deploy-quick.ts`)

Tests the entire deploy-quick mechanism without overwriting files:

1. **test-deploy-quick.ts** creates a zip using `scripts/create-deploy-zip.ts`
   - Output: `dataTemp/quick-deploy-outbound.zip` (same as production)
2. **test-deploy-quick.ts** computes MD5 of zip, POSTs to `localhost:4000/admin/deploy-quick?test=true` with `X-Content-MD5` header
3. **Server** receives zip, validates MD5, saves to `dataTemp/quick-deploy-inbound.zip`
4. **Server** validates zip by extracting in-memory (same as production)
5. **Server** spawns `scripts/relaunch.ts --test --log=<path> --md5=<hash>` as detached process
6. **Server** responds with `{ ok, logFile, fileCount, ... }` then shuts down gracefully
7. **relaunch.ts --test** logs everything to the specified log file
8. **relaunch.ts --test** waits for server to exit
9. **relaunch.ts --test** reads zip, validates MD5, extracts in memory (no CLI), logs each file it WOULD write, does NOT write to app directory
10. **relaunch.ts --test** starts the server (same as production!)
11. **test-deploy-quick.ts** polls `/ping` until server responds
12. **test-deploy-quick.ts** reads `logFile` path from server response, scans for ERROR or WARN
13. **test-deploy-quick.ts** reports any issues found, or confirms clean run

### Key Differences: Production vs Test

| Step | Production | Test |
|------|------------|------|
| Zip filename | `quick-deploy-inbound.zip` | `quick-deploy-inbound.zip` |
| Files written to app | ✅ Yes | ❌ No (just logged) |
| Server shutdown | ✅ Yes | ✅ Yes |
| Server restart | ✅ Yes | ✅ Yes |
| npm install | ✅ If needed | ❌ Skipped |
| npm run build | ✅ Yes | ❌ Skipped |

## Files Included in Zip

Whitelist approach - only these are included:

- `**/*.ts` - TypeScript source files
- `**/*.svg` - SVG assets
- `package.json`, `package-lock.json` - Dependencies
- `tsconfig.json`, `tsconfig.base.json` - TypeScript config
- `client/index.html`, `client/vite.config.ts` - Client build
- `dataConfig/prompt-template.md` - Chatbot prompt

**Excluded** (intentionally):
- `dataCountries/*.json` - Static data, rarely changes
- `dataConfig/config.*.json` - Environment-specific, already on server
- `node_modules/` - Reinstalled if package.json changes
- `dataUsers/`, `dataTrips/` - Runtime data, never overwritten

## Security

- Requires `deploybot` user with `isAdmin: true`
- Production requires `deployQuickAllowed: true` in server config
- Zip is stored in `dataTemp/` (our directory), not `/tmp` (system temp)
- Only whitelisted file types are included in zip

## Usage

```bash
# Production deploy (to AWS)
node deploy --quick

# Test deploy-quick locally (no files written)
npx tsx scripts/test-deploy-quick.ts
```

## Troubleshooting

Each relaunch run creates a timestamped log file in `dataDiagnostics/`:
- `relaunch-2025-12-03T06-45-23-456Z.log`

Output goes to both console and log file, so you can inspect after the fact.

If deploy-quick fails, you can always do a full deploy:
```bash
node deploy
```

## Status Server

While relaunch is running (production only), it serves a minimal HTTP server on port 80 that responds to `/api/admin/deploy-quick-status` with the current log file contents. This allows `deploy.js` (or the operator) to monitor progress remotely.

- Starts immediately after the main server shuts down
- Stops just before starting the real server
- Returns 503 for any other URL with a helpful message
- On catastrophic failure, **keeps running forever** so the operator can diagnose
- **Requires root/admin** - Port 80 is a privileged port. Our Docker container runs as root, so this works in production. In test mode, the status server is skipped (just logged).

## Failure Modes

### Safe Failures (Server Restarts)

If a failure occurs **before** any files are written to the app directory, the existing code is intact. The relaunch script stops the status server, restarts the main server with unchanged code:

- MD5 checksum mismatch (zip corrupted in transit)
- Zip file cannot be read or parsed
- Zip decompression fails

### Unsafe Failures (Status Server Keeps Running)

If a failure occurs **after** files have been written, the code on disk is in an unknown state. Starting the server could execute corrupt or incomplete code. The relaunch script:

1. Logs the error
2. Does NOT restart the server
3. Keeps the status server running on port 80 forever
4. Waits indefinitely so operator can query `/api/admin/deploy-quick-status`

Failures in this category:
- File write fails partway through deployment
- `npm install` fails
- `npm run build` fails

**Recovery from unsafe failure:** 
1. Query `/api/admin/deploy-quick-status` to see what went wrong
2. SSH to server and kill the relaunch process
3. Run `node deploy` for a full rebuild

## Appendix: relaunch.ts Exit Conditions

This documents all the ways `relaunch.ts` can terminate and the state of port 80 in each case.

### Exit Conditions Table

| Condition | Server Running? | Port 80 | Prod Outcome | Test Outcome |
|-----------|-----------------|---------|--------------|--------------|
| Missing arguments (zipPath, appRoot) | Yes (never shut down) | Not started | `exit(1)` | `exit(1)` |
| Missing `--md5` argument | Yes (never shut down) | Not started | `exit(1)` | `exit(1)` |
| Server didn't shut down in 30s | Yes (still running) | Not started | `exit(1)` | `exit(1)` |
| MD5 mismatch (safe failure) | Yes (restarted) | Stopped | `exit(1)` | `exit(1)` |
| Zip parse/decompress fails (safe failure) | Yes (restarted) | Stopped | `exit(1)` | `exit(1)` |
| Server spawn fails after safe failure | No | Status server running | Port 80 hangs | `exit(1)` |
| Success | Yes (new/unchanged code) | Stopped | `exit(0)` | `exit(0)` |
| File write fails (unsafe) | No | Status server running | Port 80 hangs | N/A (no writes) |
| `npm install` fails (unsafe) | No | Status server running | Port 80 hangs | N/A (skipped) |
| `npm run build` fails (unsafe) | No | Status server running | Port 80 hangs | N/A (skipped) |
| Server spawn fails after build (unsafe) | No | Status server running | Port 80 hangs | `exit(1)` |

### Port 80 Status Server Lifecycle

**Production mode:**
1. Starts immediately after old server shuts down
2. Serves `GET /api/admin/deploy-quick-status` with current log file
3. Returns 503 for all other URLs with helpful message
4. Stops just before spawning the real server
5. If spawn fails, restarts and runs forever

**Test mode:**
- Never started (port 80 requires admin on Windows)
- Just logs `[TEST] Status server would start/stop now`

### Key Invariants

1. **If relaunch exits, a server is running** - Either the old server (never shut down, or restarted after safe failure) or the new server (successful deploy).

2. **If relaunch hangs, no server is running** - The status server on port 80 provides diagnostics. Query `/api/admin/deploy-quick-status` to see what went wrong.

3. **The real server also serves `/admin/deploy-quick-status`** - After restart, you can query the same endpoint on the real server to see the last relaunch log, even if it was a safe failure that restarted successfully.
