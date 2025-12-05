#!/usr/bin/env node
/**
 * server-runner.ts - Process manager for deploy-quick support
 * 
 * This runs as the direct child of dumb-init (PID 1 in Docker).
 * It spawns the actual server and monitors for exit codes:
 * 
 *   - Exit code 99: Deploy-quick requested, restart the server
 *   - Any other exit: Propagate the exit, container will stop
 * 
 * Usage in Dockerfile:
 *   CMD ["node", "server/dist/server-runner.js"]
 * 
 * ============================================================================
 * WARNING: WHY THIS EXISTS (AND WHY THE OLD WAY FAILED)
 * ============================================================================
 * 
 * We use dumb-init as PID 1 in Docker to handle signals properly. But dumb-init
 * exits when its direct child exits. Our old deploy-quick approach was:
 * 
 *   1. Server receives deploy-quick request
 *   2. Server spawns relaunch.ts as a detached process
 *   3. Server exits
 *   4. relaunch.ts extracts files, rebuilds, starts new server
 * 
 * This FAILED because:
 *   - Step 3: Server (dumb-init's child) exits
 *   - dumb-init sees child exit → container dies
 *   - relaunch.ts dies with the container, never restarts anything
 * 
 * The NEW approach with server-runner:
 * 
 *   dumb-init (PID 1)
 *       └── server-runner (this file, stays running)
 *               └── server (does work, can exit with code 99)
 * 
 *   1. Server receives deploy-quick request  
 *   2. Server extracts files, rebuilds (while still responding to health checks!)
 *   3. Server exits with code 99
 *   4. server-runner sees code 99, spawns fresh server
 *   5. dumb-init never sees its child exit, container stays alive
 * 
 * Benefits:
 *   - No separate relaunch process
 *   - No port handoff race conditions  
 *   - Health checks pass the whole time
 *   - Clean process hierarchy
 * ============================================================================
 */

import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";

const DEPLOY_QUICK_EXIT_CODE = 99;
const SERVER_SCRIPT = path.join(process.cwd(), "server/src/index.ts");

let serverProcess: ChildProcess | null = null;
let isShuttingDown = false;

function log(message: string) {
  console.log(`[ServerRunner] ${message}`);
}

function startServer(): ChildProcess {
  log(`Starting server: npx tsx ${SERVER_SCRIPT}`);
  
  const child = spawn("npx", ["tsx", SERVER_SCRIPT], {
    stdio: "inherit",
    env: process.env,
    shell: true  // Needed for npx on Windows
  });
  
  child.on("exit", (code, signal) => {
    if (isShuttingDown) {
      return;
    }
    
    if (signal) {
      log(`Server killed by signal ${signal}`);
      process.exit(1);
    }
    
    if (code === DEPLOY_QUICK_EXIT_CODE) {
      log(`Server exited with code ${DEPLOY_QUICK_EXIT_CODE} - deploy-quick requested`);
      log("Restarting server...");
      serverProcess = startServer();
    } else {
      log(`Server exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });
  
  child.on("error", (err) => {
    log(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
  
  return child;
}

// Forward signals to the server process
function forwardSignal(signal: NodeJS.Signals) {
  process.on(signal, () => {
    log(`Received ${signal}, forwarding to server`);
    isShuttingDown = true;
    if (serverProcess) {
      serverProcess.kill(signal);
    }
  });
}

forwardSignal("SIGTERM");
forwardSignal("SIGINT");
forwardSignal("SIGHUP");

// Start the server
log("Server runner starting");
serverProcess = startServer();
