#!/usr/bin/env node
/**
 * setup.js - Environment setup for Travelr
 * 
 * Usage:
 *   node setup.js                        - Show help and current env var status
 *   node setup.js dev                    - Set TRAVELR_CONFIG to dev-<os>
 *   node setup.js <key> <value>          - Set an environment variable
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

const ENV_VARS = [
  { name: "TRAVELR_CONFIG", purpose: "Environment config selector" },
  { name: "TRAVELR_DEPLOYBOT_PWD", purpose: "Deploybot user password for admin operations" },
  { name: "OPENAI_API_KEY", purpose: "ChatGPT integration" },
  { name: "GOOGLE_CS_API_KEY", purpose: "Google Custom Search" },
  { name: "GOOGLE_CS_CX", purpose: "Google Programmable Search Engine ID" }
];

function detectConfigValue() {
  const os = platform();
  
  if (os === "win32") {
    return "dev-win";
  }
  if (os === "linux") {
    if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) {
      return "prod-debian";
    }
    return "dev-linux";
  }
  if (os === "darwin") {
    return "dev-macos";
  }
  return "dev";
}

function formatValue(name, value) {
  if (!value) {
    return "(not set)";
  }
  // Mask secret keys and passwords - show first 4 chars + ellipsis
  if (name.includes("API") || name.includes("KEY") || name.includes("CX") || name.includes("PWD")) {
    return value.slice(0, 4) + "...";
  }
  return value;
}

function showStatus() {
  console.log("\nTravelr Environment Variables:\n");
  
  for (const { name, purpose } of ENV_VARS) {
    const value = process.env[name];
    console.log(`  ${name.padEnd(18)} = ${formatValue(name, value)}`);
    console.log(`                     # ${purpose}`);
  }
  
  console.log(`
Usage:
  node setup.js dev                     Set TRAVELR_CONFIG to dev-<os>, causing config.dev-<os>.json to be loaded
  node setup.js <key> <value>           Set a travelr environment variable

Examples:
  node setup.js dev
  node setup.js OPENAI_API_KEY sk-proj-xxx
  node setup.js GOOGLE_CS_API_KEY AIzaSyxxx
  node setup.js GOOGLE_CS_CX abc123xyz
`);
}

function setEnvVar(name, value) {
  const os = platform();
  
  console.log(`Setting ${name}=${formatValue(name, value)}`);
  console.log(`Restart terminal to see the change.`);
  
  if (os === "win32") {
    try {
      execSync(`setx ${name} "${value}"`, { stdio: "pipe" });
    } catch (error) {
      console.error(`Failed to set ${name}: ${error.message}`);
      process.exit(1);
    }
  } else {
    const shell = process.env.SHELL ?? "/bin/bash";
    let profileFile = "~/.bashrc";
    
    if (shell.includes("zsh")) {
      profileFile = "~/.zshrc";
    } else if (shell.includes("fish")) {
      profileFile = "~/.config/fish/config.fish";
    }
    
    const exportLine = `export ${name}="${value}"`;
    console.log(`\nTo set permanently, add this line to ${profileFile}:`);
    console.log(`  ${exportLine}`);
  }
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  // No args: show help and status
  showStatus();
} else if (args.length === 1 && args[0] === "dev") {
  // "dev" command: set TRAVELR_CONFIG
  const configValue = detectConfigValue();
  setEnvVar("TRAVELR_CONFIG", configValue);
} else if (args.length === 2) {
  // Two args: set key=value
  const [key, value] = args;
  setEnvVar(key, value);
} else {
  console.error("Error: Invalid arguments.\n");
  showStatus();
  process.exit(1);
}
