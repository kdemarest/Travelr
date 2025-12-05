/**
 * dispatch-registry.ts - All command registrations in one place
 * 
 * This file contains the wiring knowledge: which functions handle which commands,
 * and how to extract config values for each. The functions themselves stay pure.
 */

import { registerOpCommand } from "./op-registry.js";

// Import all dispatchable functions
import { deployQuick } from "./deploy-quick.js";
import { deployFull } from "./deploy-full.js";
import { deployAudit } from "./deploy-audit.js";
import { stopService, startService, getStatus, waitForService } from "./service-control.js";
import { persistRemoteService } from "./remote-admin.js";

// ============================================================================
// Deploy Commands
// ============================================================================

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
    // CLI-only
    local: "",
    target: "",
    skipSmoke: "",
    dryRun: "",
  },
  description: "Quick deploy (zip + upload + restart)",
  examples: [
    "deploy -quick",
    "deploy -quick -local",
    "deploy -quick -target http://localhost:4000",
    "deploy -quick -dryRun",
  ],
});

registerOpCommand({
  group: "deploy",
  flag: "full",
  fn: deployFull,
  paramMap: {
    // All config-sourced via opsConfig() inside the function
    // CLI-only options
    skipSmoke: "",
    skipPersist: "",
    force: "",
    wait: "",
    dryRun: "",
  },
  description: "Full Docker build + push + App Runner deploy",
  examples: [
    "deploy -full",
    "deploy -full -skipSmoke",
    "deploy -full -force",
    "deploy -full -dryRun",
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
  description: "Pause the App Runner service (stops billing)",
  examples: ["deploy -stop", "deploy -stop -wait"],
});

registerOpCommand({
  group: "deploy",
  flag: "resume",
  fn: startService,
  paramMap: {
    region: "aws.region",
    serviceName: "name",
  },
  description: "Resume a paused App Runner service",
  examples: ["deploy -resume", "deploy -resume -wait"],
});

registerOpCommand({
  group: "deploy",
  flag: "status",
  fn: getStatus,
  paramMap: {
    region: "aws.region",
    serviceName: "name",
    wait: "",  // CLI-only param
  },
  description: "Show current App Runner service status (-wait to poll until complete)",
  examples: ["deploy -status", "deploy -status -wait"],
});

registerOpCommand({
  group: "deploy",
  flag: "wait",
  fn: waitForService,
  paramMap: {
    region: "aws.region",
    serviceName: "name",
  },
  description: "Wait for in-progress operation to complete",
  examples: ["deploy -wait"],
});

registerOpCommand({
  group: "deploy",
  flag: "audit",
  fn: deployAudit,
  paramMap: {},
  description: "Audit deployment state (local vs ECR vs App Runner vs production)",
  examples: ["deploy -audit"],
});

registerOpCommand({
  group: "deploy",
  flag: "persist",
  fn: persistRemoteService,
  paramMap: {
    port: "container.port",
    healthCheckPath: "container.healthCheck.path",
    healthCheckExpected: "container.healthCheck.expected",
    authUser: "auth.user",
    authEndpoint: "auth.endpoint",
    passwordEnvVar: "auth.passwordEnvVar",
  },
  description: "Sync data from running service to S3",
  examples: ["deploy -persist"],
});

// ============================================================================
// Test Environment Commands (future)
// ============================================================================

// registerOpCommand({
//   group: "testenv",
//   flag: "spawn",
//   fn: testSpawnServer,
//   configMap: { ... },
//   description: "Spawn isolated test server",
//   examples: ["testenv -spawn", "testenv -spawn -port 60001"],
// });

// ============================================================================
// Test Runner Commands (future)
// ============================================================================

// registerOpCommand({
//   group: "test",
//   flag: "run",
//   fn: testRun,
//   configMap: { ... },
//   description: "Run test suite",
//   examples: ["test -run deploy-quick", "test -run all"],
// });
