# Test Server Isolation Specification

## Problem

Running tests against the dev server causes collisions:
- Shared PID file (`server.pid`)
- Shared data directories (`dataUsers/`, `dataTrips/`, etc.)
- Shared config files
- Port conflicts

## Solution: Isolated Test Environments

Each test server runs in a completely isolated environment:
1. **Unique port** in range 5000-5999
2. **Dedicated test directory** as the working directory
3. **Fresh copy** of data files for each test run
4. **No shared state** with dev server or other test instances

## Key Insight: cwd-Based Data Paths

The server resolves data paths relative to `process.cwd()`, not `__dirname`:

```typescript
// Data directories - relative to cwd (where you run the server FROM)
const dataRoot = process.cwd();
const dataTripsDir = path.join(dataRoot, "dataTrips");
const dataUsersDir = path.join(dataRoot, "dataUsers");
// etc.

// Code directories - relative to __dirname (where the code LIVES)
const clientDistDir = path.resolve(__dirname, "../../client/dist");
const scriptsDir = path.resolve(__dirname, "../../scripts");
```

This means:
- **Normal dev**: `cd travelr && node server/dist/index.js` → uses `travelr/data*/`
- **Test**: `cd TEST_5000 && node ../server/dist/index.js` → uses `TEST_5000/data*/`

## Directory Structure

```
travelr/
├── server/dist/index.js       # The server code (shared)
├── client/dist/               # Static files (shared)
├── scripts/                   # Scripts (shared)
├── dataCountries/             # Static country/exchange data (shared)
├── dataUsers/                 # Dev data (not used in tests)
├── dataTrips/                 # Dev data (not used in tests)
└── TEST_5000/                 # Test environment for port 5000
    ├── dataConfig/
    │   └── config.test.json   # Generated config for this port
    ├── dataUsers/
    │   └── users.json         # Copy from main dataUsers/
    ├── dataUserPrefs/
    │   └── *.json             # Copy from main dataUserPrefs/
    ├── dataTrips/
    │   └── *.travlrjournal    # Copy from main dataTrips/
    ├── dataDiagnostics/       # Created empty, logs go here
    ├── dataTemp/              # Created empty, temp files go here
    └── server.pid             # PID file for THIS instance only
```

## Port Allocation

- **Range**: 5000-5999 (1000 possible concurrent tests)
- **Selection**: Via `TEST_PORT` environment variable, or auto-select first available
- **Directory naming**: `TEST_5000/`, `TEST_5001/`, etc.

## spawn-test-server.ts Behavior

### Startup Sequence

1. **Determine port**
   - Use `TEST_PORT` env var if set
   - Otherwise, scan 5000-5999 for first port where `TEST_<port>/` doesn't exist
   
2. **Clean slate**
   - If `TEST_<port>/` exists, delete it entirely (recursive)
   - Create fresh `TEST_<port>/` directory

3. **Copy data files**
   - Copy `dataUsers/` → `TEST_<port>/dataUsers/`
   - Copy `dataUserPrefs/` → `TEST_<port>/dataUserPrefs/`
   - Copy `dataTrips/` → `TEST_<port>/dataTrips/`
   - Copy `dataConfig/` → `TEST_<port>/dataConfig/`
   - Create empty `TEST_<port>/dataDiagnostics/`
   - Create empty `TEST_<port>/dataTemp/`

4. **Generate test config**
   - Create `TEST_<port>/dataConfig/config.test.json`:
     ```json
     {
       "serveMode": "prod",
       "whoServesStaticFiles": "express",
       "port": <port>,
       "writeDiagnosticFiles": true,
       "deployQuickAllowed": true
     }
     ```

5. **Build server** (if needed)
   - Run `npm run build` in `server/` directory

6. **Start server**
   - Set environment variables:
     - `TRAVELR_CONFIG=test`
     - `TRAVELR_DATA_ROOT=TEST_<port>` (new env var for data directory override)
     - Pass through: `OPENAI_API_KEY`, `GOOGLE_CS_API_KEY`, `GOOGLE_CS_CX`, etc.
   - Spawn `node dist/index.js`
   - Wait for `/ping` to respond

7. **Signal ready**
   - Print `READY <port>` to stdout
   - Keep running until killed

### Shutdown Sequence

1. Kill server process
2. Optionally clean up `TEST_<port>/` directory (flag: `--cleanup`)

## Server Changes Required

### Centralized Path Configuration: `data-paths.ts`

The server now uses a `Paths` object in `server/src/data-paths.ts`:

```typescript
export const Paths = {
  // CODE: Where the source code lives (immutable, shared)
  codeRoot: path.resolve(__dirname, "../.."),
  get scripts() { return path.join(this.codeRoot, "scripts"); },
  get clientDist() { return path.join(this.codeRoot, "client/dist"); },
  get catalog() { return path.join(this.codeRoot, "dataCountries"); },

  // DATA: Where runtime data lives (cwd, isolated in tests)
  dataRoot: process.cwd(),
  get dataUsers() { return path.join(this.dataRoot, "dataUsers"); },
  get dataTrips() { return path.join(this.dataRoot, "dataTrips"); },
  get dataUserPrefs() { return path.join(this.dataRoot, "dataUserPrefs"); },
  get dataConfig() { return path.join(this.dataRoot, "dataConfig"); },
  get dataDiagnostics() { return path.join(this.dataRoot, "dataDiagnostics"); },
  get dataTemp() { return path.join(this.dataRoot, "dataTemp"); },
  get pidFile() { return path.join(this.dataRoot, "server.pid"); },
};
```

All modules now import and use `Paths` instead of computing paths individually.

### PID File Location

PID file is now `Paths.pidFile`, which resolves to `{cwd}/server.pid`.
Each test instance running from `TEST_5000/` gets its own PID file.

## Test Script Changes

### test-deploy-quick.ts

```typescript
// Spawn test server and get its port
const { port, kill } = await spawnTestServer();

const TEST_SERVER = `http://localhost:${port}`;

// ... run tests against TEST_SERVER ...

// Cleanup
kill();
```

### Return Value from spawnTestServer()

```typescript
interface TestServerHandle {
  port: number;           // The port the server is running on
  testDir: string;        // Path to TEST_<port>/ directory
  kill: () => void;       // Function to stop the server
  cleanup: () => void;    // Function to delete test directory
}
```

## Benefits

1. **No collisions** - Each test has its own world
2. **Parallel tests** - Run up to 1000 tests simultaneously
3. **Clean state** - Every test starts fresh
4. **Easy debugging** - Test directory persists for inspection (unless `--cleanup`)
5. **Production-like** - Uses `express` static serving, not vite

## Example Usage

```bash
# Run single test (auto-selects port)
npx tsx tests/test-deploy-quick.ts

# Run with specific port
TEST_PORT=5042 npx tsx tests/test-deploy-quick.ts

# Run multiple tests in parallel
TEST_PORT=5000 npx tsx tests/test-deploy-quick.ts &
TEST_PORT=5001 npx tsx tests/test-deploy-quick.ts &
TEST_PORT=5002 npx tsx tests/test-deploy-quick.ts &
wait
```

## Cleanup Policy

- Test directories are **not** automatically cleaned up
- This allows post-mortem debugging of failed tests
- Use `--cleanup` flag or manual deletion when done
- Consider a `clean-test-dirs.ts` script to purge all `TEST_*/` directories
