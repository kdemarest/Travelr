/**
 * Server configuration module.
 * 
 * Loads config from dataConfig/config.{TRAVELR_CONFIG}.json
 * Provides typed access to configuration values.
 */

import fs from "fs-extra";
import path from "node:path";
import { Paths } from "./data-paths.js";

const dataConfigDir = Paths.dataConfig;

interface ServerConfig {
  serveMode?: "dev" | "prod";
  whoServesStaticFiles?: "vite" | "express";
  port?: number;
  vitePort?: number;
  writeDiagnosticFiles?: boolean;
  deployQuickAllowed?: boolean;
  isTest?: boolean;
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

/**
 * Get the dataTrips directory path.
 */
export function getDataTripsDir(): string {
  return Paths.dataTrips;
}

/**
 * Check if deploy-quick is allowed.
 * Must be explicitly enabled in config for security.
 */
export function isDeployQuickAllowed(): boolean {
  const config = getConfig();
  return config.deployQuickAllowed ?? false;
}

/**
 * Whether this is a test environment (isTest in config).
 * Used to skip npm install during deploy-quick (protects junction-linked node_modules).
 */
export function isTestMode(): boolean {
  const config = getConfig();
  return config.isTest ?? false;
}
