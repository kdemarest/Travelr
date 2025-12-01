/**
 * Server configuration module.
 * 
 * Loads config from dataConfig/config.{TRAVELR_CONFIG}.json
 * Provides typed access to configuration values.
 */

import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataConfigDir = path.resolve(__dirname, "../../dataConfig");

interface ServerConfig {
  serveMode?: "dev" | "prod";
  whoServesStaticFiles?: "vite" | "express";
  port?: number;
  vitePort?: number;
  writeDiagnosticFiles?: boolean;
}

let cachedConfig: ServerConfig | null = null;
let configLoaded = false;

/**
 * Load configuration from file. Safe to call multiple times.
 */
export async function loadConfig(): Promise<ServerConfig> {
  if (configLoaded && cachedConfig) {
    return cachedConfig;
  }
  
  const configEnv = process.env.TRAVELR_CONFIG ?? "dev-win11";
  const configFileName = `config.${configEnv}.json`;
  
  try {
    const configPath = path.join(dataConfigDir, configFileName);
    cachedConfig = await fs.readJson(configPath) as ServerConfig;
    console.log(`Loaded config from ${configFileName}`);
  } catch {
    console.warn(`Config file ${configFileName} not found, using defaults`);
    cachedConfig = {};
  }
  
  configLoaded = true;
  return cachedConfig;
}

/**
 * Get configuration synchronously (must call loadConfig first during bootstrap).
 */
export function getConfig(): ServerConfig {
  return cachedConfig ?? {};
}

/**
 * Check if diagnostic file writing is enabled.
 * Defaults to true for dev, false for prod.
 */
export function shouldWriteDiagnostics(): boolean {
  const config = getConfig();
  
  // If explicitly set in config, use that
  if (config.writeDiagnosticFiles !== undefined) {
    return config.writeDiagnosticFiles;
  }
  
  // Default: enabled in dev, disabled in prod
  const configEnv = process.env.TRAVELR_CONFIG ?? "dev-win11";
  return configEnv.startsWith("dev");
}

/**
 * Get server port from config.
 */
export function getServerPort(): number {
  const config = getConfig();
  return Number(process.env.PORT ?? config.port ?? 4000);
}

/**
 * Check if Express should serve static files.
 */
export function shouldExpressServeStatic(): boolean {
  const config = getConfig();
  return config.whoServesStaticFiles === "express";
}
