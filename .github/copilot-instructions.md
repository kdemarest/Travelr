# Copilot Coding Guidelines for Travelr

These guidelines seek to cover top level specifications, architecture, coding policies, usage, and overview development, testing, and ops.

## Specification Files (*-spec.md)

Spec files document **Key Requirements** and **Expected Usage**, not **what format**. Keep them concise:

- **Focus on the big picture**: lifecycles, flows, requirements, organization, key patterns (eg registry pattern)
- **Don't duplicate what's obvious from the data files** (e.g., JSON structure in users.json)
- **Tables over prose** for things like route protection, file purposes
- **Brief examples** using project scripts (e.g., `post.ts`), not raw curl commands
- **Key behaviors** that aren't obvious from reading the code (e.g., "auth keys never expire")

For example, a good spec for auth answers: What routes require auth? What types of auth do we support? When are key files created/updated? How do I test auth?

## File Architecture

### Data Directories
| Directory | Contents | Storage | Lifecycle |
|-----------|----------|---------|------------|
| `dataTrips/` | Per-trip journal (append-only) + conversation (rolling window) | S3 in prod | Created on first trip command |
| `dataUsers/` | User credentials, auth sessions, user state | S3 in prod | Manual setup; updated on login/logout |
| `dataUserPrefs/` | Per-user preferences | S3 in prod | Created on first pref change |
| `dataConfig/` | Environment-specific config files | Always local | Manual setup |
| `dataCountries/` | Country data, exchange rates | S3 in prod | Static reference data |
| `dataDiagnostics/` | Last request/response, debug logs | Always local | Overwritten each request for debugging |
| `dataTemp/` | Temporary files (deploy extraction, etc.) | Always local | Ephemeral, can be deleted |

### Code Files
- Command handlers: `cmd-*.ts`
- API routers: `api-*.ts`
- Scripts: `/scripts/*.ts` - one-off tools, avoid module dependencies
- Tests: `/tests/test-*.ts`

## Environment

### Environment Variables
- `TRAVELR_DEPLOYBOT_PWD` - Password for deploybot user (required for admin endpoints)
- `TRAVELR_ADMIN_PWD` - Password for admin user
- `TRAVELR_TESTBOT_PWD` - Password for testbot user
- `OPENAI_API_KEY` - For chatbot functionality
- `GOOGLE_CS_API_KEY`, `GOOGLE_CS_CX` - For web search
- `PORT` - Overrides config port if set
- `NODE_ENV` - Set to `production` in container

### System Users (admin, deploybot, testbot)
System users are defined ONLY by environment variables - they are never stored in `users.json` or `auths.json`:
- Auth is validated directly against env var password/hash on every request
- No session tokens are stored or required
- S3 sync is completely uninvolved
- In dev: uses `_PWD` env vars (plaintext, hashed on demand)
- In prod: uses `_PWDHASH` env vars (pre-hashed by deploy-full.ts)

### Config Files
- `dataConfig/config.dev-win11.json` - Local Windows dev config
- `dataConfig/config.prod-debian.json` - Production container config
- `.jeestyops/config.json` - Ops/deployment configuration (used by `@jeesty/ops`)

### Ports
- **Dev API server**: `http://localhost:4000` (Express, configured in `dataConfig/config.dev-win11.json`)
- **Dev Vite server**: `http://localhost:5173` (frontend dev server with HMR)
- **Production**: Port 4000 inside container, mapped by AWS AppRunner

## Web Architecture

### Storage Abstraction
- `Storage` interface in `storage.ts` abstracts local filesystem vs S3
- `StorageLocal` wraps `fs` module for local files
- `StorageS3` uses AWS SDK for S3 bucket access
- `getStorageFor(key)` returns the appropriate backend based on key prefix and environment
- `dataConfig/` and `dataTemp/` always use local storage; everything else uses S3 in production
- All Storage methods are **async** (returns Promises)

### Fresh Deploy Handling
- On first deploy with empty S3 bucket, all files return null
- LazyFile and LazyAppendFile use default values when files don't exist
- Files are created in S3 on first write (e.g., first user login creates auth files)

### Web-Friendly Architecture
- On web servers, although atomic "get request, read file, write file, respond" is the standard, we are caching data because this is always going to be a single-server, single instance project. And we want to save $ on AWS S3.

### ClientDataCache Pattern
- Server-side: `user.clientDataCache.set("key", value)` to queue data for client
- Automatically included in responses when dirty
- Client completely replaces its cache when receiving new data
- Use `cache-population.ts` helpers to populate common data (trips, models)

### External Service Degradation
- OpenAI unavailable: commands still work, chatbot returns error message
- Google Search unavailable: chatbot works but can't augment with web results
- ip-api.com unavailable: login succeeds, city defaults to "unknown"
- AWS S3 unavailable: server starts but user data operations fail (S3 is authoritative for user data in production)

## Code Architecture

### Data Authority
- I generally prefer "single point of authority" for all data
- Copying and caching is acceptable if done carefully, and var naming clearly indicates the non-authoritative status of, eg "dataCache".

### Single Source of Truth for Lookups
- When data can come from multiple sources (e.g., system users vs file users), create ONE unified lookup function
- The function returns the same shape regardless of source
- All consumers call this one function - never check sources directly
- Example: `getUserRecord(userId)` returns a UserEntry whether the user is a system user or file user

### Code Paths and Early Exit
- I dislike early exit, if the following code will handle the case.
- For example, if array a is [], and that implies no further processing will be done, I would not choose to test for it and return. I'd let it continue, and have one and only one code path, to improve debugging and maintenance

### Dry Run / Test Mode Philosophy
- A dry run is meaningless if it branches significantly from the real code path
- Use tiny, surgical interceptions: `if (dryRun) logWouldWrite() else actuallyWrite()`
- The rest of the code path must be identical to ensure the dry run tests reality
- Same applies to test modes - maximize shared code path with production

### TypeScript
- Prefer explicit types over `any`
- Use `type` imports when importing only types
- Run `npx tsc --noEmit` to verify changes compile

### Coding Policies

#### Comments
- File header or class header explainers are fine
- Function names should be self-documenting.
- Do not write, per function, a /** ... */ block unless the function is very obscure.
- Unexpected nuances or "policies of use" deserve big comments with "WARNING" in them
- Example: LazyFile's requirement to never reassign `data`

## Code Patterns

### LazyFile Pattern
- Eager loads and lazy debounced writes
- In-memory caching with debounced writes for JSON-like data
- `load()` is **async** - call once at startup, await it
- `flush()` is **async** - call on shutdown, await it
- `setDirty()` is sync - just schedules a write via setTimeout
- Always mutate `data` in place, never reassign it
- The `__dataVerifier` field catches accidental reassignment
 
### LazyAppendFile Pattern
- Append-only file with in-memory cache, used for journals
- `load()` and `flush()` are **async**
- `append()` is sync - updates memory immediately, debounces storage write
- Never rewrites entire file, only appends (except S3 which does read-modify-write)

## App Development

### Data Design
- **Journal**: Append-only log of commands that compiles to a TripModel (source of truth)
- **Conversation**: Sliding window of chat log entries for GPT context
- The app must work if the chatbot is unavailable (commands still function)
- The chatbot must work if web search is unavailable (graceful degradation)

### Command Architecture
- Each `cmd-*.ts` file owns its command's parsing and handling
- Exception: `TripModelCompiler` centralizes journal-to-model compilation for easier debugging
- Command handlers return `CommandHandlerResult`, not raw response objects

#### Error Handling
- Use `CommandError` for user-facing errors in command handlers, not plain `Error`
- `CommandError` includes a `statusCode` for HTTP responses

#### Policy: Command Handler Results
- Use `message` for simple text responses to the user
- Use `data` only for structured data the client actually needs
- Use `stopProcessingCommands: true` to halt batch processing on errors
- Don't create special response fields (like `help`, `summary`) when `message` suffices

## Testing

### Testing HTTP Endpoints
- Use `scripts/post.ts` for quick HTTP tests against dev or production
- Server flags: `-dev` (default, localhost:4000) or `-prod` (AWS AppRunner)
- Auth flags: `-deploybot` or `-testbot` (handles login automatically)
- Examples:
  - `npx tsx scripts/post.ts /ping` — simple GET to dev
  - `npx tsx scripts/post.ts -deploybot /admin/deploy-quick-status` — authenticated GET to dev
  - `npx tsx scripts/post.ts -prod -deploybot /admin/deploy-quick-status` — authenticated GET to prod
  - `npx tsx scripts/post.ts -testbot /api/trip/demo/command '{"command":"help"}'` — POST with body
- No body = GET, with body = POST
- Env vars: `TRAVELR_DEPLOYBOT_PWD`, `TRAVELR_TESTBOT_PWD`

## Operations

### Dev Server Notes
- Dev servers run continuously with auto-restart - don't start them manually
- Server: `cd server && npm run dev`
- Client: `cd client && npm run dev`

### Commands
- deploy [-full -quick]
- sandbox
- test

### Key Endpoints
Use these during development and ops
- `/ping` - Health check, returns `pong`
- `/version` - Returns version string from `version.txt` (no auth required)
- `/auth` - POST with `{user, password, deviceId}` to authenticate
- `/admin/deploy-quick` - POST zip file for quick deploy
- `/api/trip/:tripName/command` - POST commands to a trip

### Quick Deploy
- Quick deploy to production: `npx tsx scripts/quick-deploy.ts -prod`
- Quick deploy to local dev: `npx tsx scripts/quick-deploy.ts http://localhost:4000`
- The script creates a zip, authenticates, and uploads to `/admin/deploy-quick`
- Check status: `/admin/deploy-quick-status` (requires auth)
- Full docker deploy: `node deploy.js` (builds and pushes to AWS AppRunner)

### Ops Architecture
- The "ops" modules will be an npm @jeesty/ops
- Each ops function (deploy..., test... etc) should be fairly context-free, fully data-driven, with only required parameters
- They are all front-ended with a registration-driven dispatcher

## Security

### Auth
- ALWAYS check the auth-spec.md document before changing auth
- Is auth failing unexpectedly? Check auth-spec.md

### Password Management
- Use `scripts/hashPassword.ts <password>` to generate a new hash
- Use `scripts/verifyPassword.ts <password> --user <username>` to verify a password matches

## Common AI Chatbot Mistakes

### CRITICAL: Jeesty MCP Failures
**If any `mcp_jeesty-mcp_*` tool call fails, STOP ALL WORK IMMEDIATELY.**
- Do NOT attempt workarounds (curl, manual commands, etc.)
- Do NOT continue with other tasks
- IMMEDIATELY notify the user with:
  1. Which tool failed
  2. The exact error message
  3. What you were trying to accomplish
- The MCP server is essential infrastructure - failures indicate a configuration problem that the user must fix

### URGENT: Password Hash Rules
**NEVER modify password hashes without EXPLICIT user permission.**
- `dataUsers/users.json` contains password hashes - DO NOT TOUCH without asking
- If a test fails due to auth, ASK the user before changing any hash
- If you generate a hash with `scripts/hashPassword.ts`, DO NOT apply it without permission
- Use `scripts/verifyPassword.ts` to CHECK if a password matches first

### Windows Shell
- If you're trying to accomplish anything in a windows shell, strongly consider writing a js script instead and running that!
- Even inside tools, use node calls instead of CLI, when possible!
