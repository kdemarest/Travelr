# Jeesty Ops Configuration

This directory configures [@jeesty/ops](https://www.npmjs.com/package/@jeesty/ops) for this project.

## What is @jeesty/ops?

Deployment and operations tooling for single-instance Node.js projects on AWS. It provides:

- **Quick Deploy** - Push code changes without rebuilding Docker
- **Full Deploy** - Build and deploy Docker images to AWS AppRunner
- **Sandbox** - Spin up isolated test environments locally
- **Service Control** - Start/stop/restart the production service

## Assumptions

This tooling assumes:

1. **Single-instance architecture** - One server, one container, no horizontal scaling
2. **AWS AppRunner** - Container hosting with automatic HTTPS and health checks
3. **AWS S3** - Persistent data storage (journals, user data, etc.)
4. **AWS ECR** - Docker image registry
5. **Express.js server** - With `/ping` health check endpoint
6. **Authentication** - Password-based auth for admin endpoints

## Files

| File | Purpose |
|------|---------|
| `config.json` | Project-specific deployment configuration |
| `README.md` | This documentation |

## config.json Reference

```json
{
  "name": "myproject",           // Project name (used for AWS resources)
  
  "aws": {
    "region": "us-east-1",       // AWS region
    "s3Bucket": "myproject-data" // S3 bucket for persistent data
  },
  
  "container": {
    "port": 4000,                // Port the server listens on
    "healthCheck": {
      "path": "/ping",           // Health check endpoint
      "expected": "pong"         // Expected response body
    }
  },
  
  "auth": {
    "user": "deploybot",                    // User for admin operations
    "passwordEnvVar": "MYPROJECT_DEPLOYBOT_PWD",  // Env var with password
    "endpoint": "/auth"                     // Auth endpoint
  },
  
  "deployQuick": {
    "endpoint": "/admin/deploy-quick",      // Quick deploy endpoint
    "restartExitCode": 99,                  // Exit code that triggers restart
    "include": [                            // Files to include in quick deploy
      "server/src/**",
      "client/src/**",
      "package.json"
    ],
    "exclude": ["node_modules", "dist"]     // Files to exclude
  },
  
  "persist": {
    "dirs": ["dataTrips", "dataUsers"]      // Directories synced to/from S3
  },
  
  "secrets": ["OPENAI_API_KEY"]             // Required env vars for production
}
```

## Commands

### Quick Deploy
Push code changes to production without rebuilding Docker:
```bash
npx tsx scripts/quick-deploy.ts -prod
```

### Full Deploy
Build Docker image and deploy to AWS AppRunner:
```bash
node deploy.js
```

### Sandbox
Spin up an isolated local test environment:
```bash
# Via wrapper script (recommended)
sandbox -spawn -copycode

# Or directly
npx tsx scripts/sandbox.ts -spawn -copycode
```

Available commands:
- `sandbox -spawn` - Start test server with isolated data
- `sandbox -spawn -copycode` - Also copy code (required for deploy-quick tests)
- `sandbox -list` - Show all test servers
- `sandbox -kill <port>` - Stop a test server
- `sandbox -remove <port>` - Stop and delete test directory

See `scripts/sandbox.ts` for details.

### Service Control
```bash
# Check service status
npx @jeesty/ops status

# Restart service
npx @jeesty/ops restart
```

## Sandbox Details

The sandbox creates isolated test environments in `testDirs/TEST_<port>/`:

- **Port range**: 60000-60999 (safe, won't conflict with dev servers)
- **Data isolation**: Fresh data directories copied from templates
- **Code isolation**: With `-copycode`, uses junctions to server/client code
- **Cleanup**: `-remove <port>` kills server and deletes directory

Use sandbox when:
- Running integration tests that modify data
- Testing deploy scripts against a real server
- Debugging without affecting your dev environment

## Environment Variables

Required for deployment:
- `MYPROJECT_DEPLOYBOT_PWD` - Password for deploybot user
- Secrets listed in `config.json` (e.g., `OPENAI_API_KEY`)

For production, set these in AWS AppRunner environment configuration.
