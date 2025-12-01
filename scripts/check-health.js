#!/usr/bin/env node
/**
 * Health check script for Travelr servers.
 * Verifies that the API server and/or web server are responding.
 * 
 * Usage:
 *   node scripts/check-health.js          # Check both servers
 *   node scripts/check-health.js api      # Check API server only
 *   node scripts/check-health.js web      # Check web server only
 * 
 * Exit codes:
 *   0 = All requested servers are healthy
 *   1 = One or more servers failed health check
 */

const API_URL = "http://localhost:4000/ping";
const WEB_URL = "http://localhost:5173/ping";
const TIMEOUT_MS = 5000;

async function checkEndpoint(name, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    
    if (response.ok && text.trim() === "pong") {
      console.log(`✓ ${name} is healthy (${url})`);
      return true;
    } else {
      console.log(`✗ ${name} returned unexpected response: ${text.slice(0, 50)}`);
      return false;
    }
  } catch (error) {
    const message = error.name === "AbortError" 
      ? "timeout" 
      : error.cause?.code ?? error.message;
    console.log(`✗ ${name} is not responding (${message})`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const checkApi = args.length === 0 || args.includes("api");
  const checkWeb = args.length === 0 || args.includes("web");

  const results = [];

  if (checkApi) {
    results.push(await checkEndpoint("API Server", API_URL));
  }
  if (checkWeb) {
    results.push(await checkEndpoint("Web Server", WEB_URL));
  }

  const allHealthy = results.every(Boolean);
  process.exit(allHealthy ? 0 : 1);
}

main();
