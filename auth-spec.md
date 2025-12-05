# Travelr Authentication Specification

## Overview

Auth is **always required** (except `/ping` and `/auth`). The server refuses to start without an admin user configured.

## User Types

### System Users
Defined in code, authenticated via environment variables. Never stored in `users.json`.

| User | Purpose | Env Vars | isAdmin |
|------|---------|----------|---------|
| `admin` | Primary admin user | `TRAVELR_ADMIN_PWD` / `TRAVELR_ADMIN_PWDHASH` | Yes |
| `deploybot` | Deployment automation | `TRAVELR_DEPLOYBOT_PWD` / `TRAVELR_DEPLOYBOT_PWDHASH` | Yes |
| `testbot` | Automated testing | `TRAVELR_TESTBOT_PWD` / `TRAVELR_TESTBOT_PWDHASH` | No |

- `_PWD` vars: plaintext password (dev environments)
- `_PWDHASH` vars: pre-hashed password (production) - set automatically by deploy

**Required:** `admin` must be configured. Server refuses to start without `TRAVELR_ADMIN_PWD` or `TRAVELR_ADMIN_PWDHASH`.

### File Users
Regular users stored in `dataUsers/users.json`. Optional - the file can be empty or missing.

## Route Protection

| Route Pattern | Auth Required | Additional Check |
|---------------|---------------|------------------|
| `/ping` | No | — |
| `/version` | No | — |
| `/auth` | No | (this is the login endpoint) |
| `/api/*` | Yes | — |
| `/admin/*` | Yes | User must have `isAdmin: true` |
| Everything else | Yes | — |

## Data Files

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `dataUsers/users.json` | File user credentials + isAdmin flag | Optional. Use `scripts/hashPassword.ts` to generate hashes. |
| `dataUsers/auths.json` | Active sessions (authKey per device) | Created on login, removed on logout. Updated on every auth validation (`lastSeen`). |
| `dataUsers/userState.json` | Per-user state (e.g., lastTripId) | Updated as user interacts with app. |

## Authentication Methods

### Session-Based (requires device ID)

Use when you have an auth key from a previous login:

**Token Auth (primary for web client):**
```
X-Auth-User: ken
X-Auth-Key: auth-xxx
X-Auth-Device: device-xxx
```

**Bearer Token (for API clients):**
```
Authorization: Bearer auth-xxx
```

### Single-Call (no device ID needed)

Use for scripts and one-off API calls. Password verified each time, no session created:

**X-Auth headers:**
```
X-Auth-User: deploybot
X-Auth-Password: secret123
```

**Basic Auth:**
```
Authorization: Basic base64(user:password)
```

## Login Flow

1. `POST /auth` with `{ user, password, deviceId, deviceInfo }`
2. Server verifies password, generates auth key, stores in `auths.json`
3. Returns `{ ok, authKey, lastTripId, clientDataCache }`
4. Client stores authKey in localStorage, uses it for subsequent requests

**Auto-login:** Client can validate a cached key with `GET /auth?user=X&deviceId=Y&authKey=Z`

## Auth Keys

- Format: `auth-` + 64 hex chars
- **Never expire** automatically
- Invalidated by: logout, re-login on same device, or manual removal
- `lastSeen` updated on every successful validation

## Password Management

```bash
# Generate a new hash
npx tsx scripts/hashPassword.ts mySecretPassword

# Verify a password against a user
npx tsx scripts/verifyPassword.ts myPassword --user deploybot
```

## Testing

Use `scripts/post.ts` for all HTTP testing:

```bash
# Public endpoint (no auth)
npx tsx scripts/post.ts /ping

# As deploybot (admin)
npx tsx scripts/post.ts -deploybot /admin/deploy-quick-status

# As testbot (non-admin)  
npx tsx scripts/post.ts -testbot /api/trip/demo/command '{"command":"help"}'

# Against production
npx tsx scripts/post.ts -prod -deploybot /admin/files
```

## Key Files

| File | What it does |
|------|--------------|
| `server/src/auth.ts` | Core auth logic |
| `server/src/index.ts` | Route definitions and `requireAuth` middleware |
| `client/src/auth.ts` | Client-side auth (localStorage, authFetch, auto-401 handling) |
| `scripts/post.ts` | HTTP testing with auto-auth |
| `scripts/hashPassword.ts` | Generate password hash |
| `scripts/verifyPassword.ts` | Verify password |
