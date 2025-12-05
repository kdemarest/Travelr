# @jeesty/ops Specification

A unified operations toolkit for Node.js applications deployed to AWS App Runner.

## API Design

### Naming Convention
All exports use prefixed names to indicate category:
- `deploy*` - Deployment functions
- `test*` - Test infrastructure functions  
- `tool*` - Utility/helper functions

### Exports
```typescript
import { 
  // Deploy
  deployFull,           // Full Docker build + push + App Runner deploy
  deployQuick,          // Quick deploy (zip + upload + restart)
  deployCreateZip,      // Create deployment zip
  deployPersist,        // Sync data to S3
  deployStop,           // Pause App Runner service
  deployResume,         // Resume App Runner service
  deployStatus,         // Get service status
  
  // Test
  testSpawnServer,      // Spawn isolated test server
  testRemoveServer,     // Remove test server
  testDeployQuick,      // Run deploy-quick test suite
  testSmoke,            // Run smoke tests
  
  // Tools
  toolPost,             // HTTP POST helper (like curl)
  toolAuthenticate,     // Get auth token
  toolGetProductionUrl, // Get App Runner URL from AWS
  toolPortPid,          // Find process using a port
  
  // Config/Classes (advanced use)
  OpsConfig,            // Configuration loader
  ServerRunner          // Process manager class
} from "@jeesty/ops";
```

### Subpath Exports
```typescript
// Express middleware (only for apps that need it)
import { deployQuickMiddleware, healthMiddleware } from "@jeesty/ops/middleware";
```

### App Script Stubs
Projects create thin wrappers in `/scripts` that import and run ops functions:

**scripts/deploy.ts:**
```typescript
#!/usr/bin/env npx tsx
import { deployFull } from "@jeesty/ops";
await deployFull();
```

**scripts/quick-deploy.ts:**
```typescript
#!/usr/bin/env npx tsx
import { deployQuick } from "@jeesty/ops";
await deployQuick();
```

**scripts/sandbox.ts:**
```typescript
#!/usr/bin/env npx tsx
import { testSpawnServer, testRemoveServer } from "@jeesty/ops";

const args = process.argv.slice(2);
if (args.includes("-spawn")) await testSpawnServer();
else if (args.includes("-remove")) await testRemoveServer(args);
```

**scripts/post.ts:**
```typescript
#!/usr/bin/env npx tsx
import { toolPost } from "@jeesty/ops";
await toolPost(process.argv.slice(2));
```

Benefits:
- Stubs are 2-3 lines each
- All logic lives in `@jeesty/ops`
- Update all projects by bumping package version
- Autocomplete shows all available functions

## Environment Assumptions

### Development Environment
- **OS**: Windows 10/11
- **Shell**: PowerShell 5.1+ (note: JSON quoting issues require `cmd /c` wrapper for complex args)
- **Node.js**: v20+ with native fetch support
- **Package Manager**: npm with workspaces
- **TypeScript**: tsx for direct .ts execution during development

### Production Environment
- **OS**: Debian Linux (via Docker)
- **Container Runtime**: Docker with dumb-init as PID 1
- **Cloud Provider**: AWS
- **Compute**: AWS App Runner (serverless containers)
- **Storage**: AWS S3 for persistent data
- **Container Registry**: AWS ECR

### Container Architecture
- Base image: `node:24-bookworm-slim`
- Process hierarchy: `dumb-init` → `server-runner` → `server`
- Non-root user for security (`travelr` user, UID 1001)
- Health check: HTTP GET `/ping` expecting "pong"

## Key Functions

### 1. Full Deploy (`deploy`)
Build and push a new Docker image, deploy to App Runner.
- Builds Docker image locally
- Pushes to ECR
- Updates App Runner service
- Waits for deployment to complete
- ~3-4 minutes total

### 2. Quick Deploy (`deploy-quick`)
Deploy code changes without rebuilding the Docker image.
- Creates zip of source files (~260KB)
- Authenticates with deploybot credentials
- POSTs zip to `/admin/deploy-quick` endpoint
- Server extracts files, runs `npm run build`, restarts
- ~6-10 seconds total

### 3. Test Server (`sandbox`)
Spawn isolated test servers for integration testing.
- Creates isolated `TEST_<port>/` directory
- Copies or junctions code and data
- Runs server on dynamic port (60000-60999)
- Supports `-copycode` for deploy-quick testing

### 4. Server Runner (`server-runner`)
Process manager that enables deploy-quick restarts.
- Runs as direct child of dumb-init
- Spawns actual server as child process
- Watches for exit code 99 → restart
- Other exit codes → propagate (container stops)
- Forwards signals (SIGTERM, SIGINT, SIGHUP)

### 5. Data Persistence (`persist`)
Sync runtime data to S3 for durability.
- Called before full deploys
- Syncs `dataTrips/`, `dataUserPrefs/`, `dataCountries/`
- S3 bucket: `travelr-persist`

### 6. Service Control (`stop`, `resume`, `status`)
Control App Runner service state.
- Pause service to save costs
- Resume when needed
- Check current status

## Authentication

### Deploybot User
- Username: `deploybot`
- Password: stored in `TRAVELR_DEPLOYBOT_PWD` environment variable
- Used for automated deploys and admin operations
- Has admin role for `/admin/*` endpoints

### Auth Flow
1. POST `/auth` with `{user, password, deviceId}`
2. Receive `{ok, authKey}`
3. Include headers: `x-auth-user`, `x-auth-device`, `x-auth-key`

## File Structure

```
ops/
  package.json          # @jeesty/ops package
  specification.md      # This file
  src/
    quick-deploy.ts     # Quick deploy implementation
    create-zip.ts       # Zip creation for quick deploy
    server-runner.ts    # Process manager
    sandbox.ts          # Test server spawning
    deploy.ts           # Full Docker deploy (future)
```

## Configuration

### Environment Variables
- `TRAVELR_DEPLOYBOT_PWD` - Deploybot password for automated deploys
- `TRAVELR_CONFIG` - Config profile (dev-win11, prod-debian, test-generic)
- `OPENAI_API_KEY` - For chatbot
- `GOOGLE_CS_API_KEY`, `GOOGLE_CS_CX` - For web search

### Config Files
- `dataConfig/config.*.json` - Environment-specific settings
- `dataConfig/prompt-template.md` - Chatbot system prompt

## Exit Codes

- `0` - Normal exit
- `1` - Error
- `99` - Deploy-quick restart requested (server-runner watches for this)

## Known Issues & Gotchas

### App Runner: update-service vs start-deployment

**Problem**: When deploying a new image to the same ECR tag (e.g., `:latest`), calling `aws apprunner update-service` is NOT enough. It only updates service configuration, not the running container.

**Symptoms**:
- AWS reports `UPDATE_SERVICE: SUCCEEDED`
- Service status shows `RUNNING`
- But the OLD code is still running!
- `UpdatedAt` timestamp doesn't change

**Solution**: ALWAYS call `aws apprunner start-deployment` after `update-service` to force App Runner to pull the latest image for the tag.

**Code location**: `ops/src/aws-apprunner.ts` in `deployToAppRunner()`

### Docker Build Cache

**Problem**: Docker may cache layers even with `--no-cache` if the build context hasn't changed in ways Docker detects.

**Solution**: We verify the ECR image digest changed after push. If unchanged, the deploy fails with a clear error.

**Code location**: `ops/src/deploy-full.ts` step 7 (ECR push verification)

## Future Considerations

- CLI tool: `npx @jeesty/ops deploy --quick`
- Multi-project support (not just travelr)
- GitHub Actions integration
- Rollback support
- Blue-green deployments
