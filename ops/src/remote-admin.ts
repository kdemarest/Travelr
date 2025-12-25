/**
 * remote-admin.ts - Authenticated calls to remote admin endpoints
 * 
 * Authenticate with a running server and call admin endpoints.
 * Used for operations like persist, status checks, etc.
 */

import { opsConfig, getProductionUrl, type OpsConfig } from "./ops-config.js";

// ============================================================================
// Types
// ============================================================================

export interface RemoteAdminOptions {
  /** Target server URL. If not provided, gets production URL from AWS */
  target?: string;
  /** Use local dev server (http://localhost:<port>) */
  local?: boolean;
  /** Custom config (if not provided, loads from jeesty-ops-config.json) */
  config?: OpsConfig;
  /** Logging function */
  log?: (message: string) => void;
  /** Password (if not provided, reads from env var in config) */
  password?: string;
  /** Device ID for auth */
  deviceId?: string;
}

export interface AuthSession {
  baseUrl: string;
  authKey: string;
  user: string;
  deviceId: string;
}

export interface AdminCallResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Authenticate with a remote server and get a session.
 */
export async function authenticate(options: RemoteAdminOptions = {}): Promise<AuthSession> {
  const config = options.config ?? opsConfig();
  const log = options.log ?? (() => {});
  const deviceId = options.deviceId ?? "device-jeesty-ops";

  // Determine target URL
  let baseUrl: string;
  if (options.target) {
    baseUrl = options.target;
  } else if (options.local) {
    baseUrl = `http://localhost:${config.container.port}`;
  } else {
    baseUrl = await getProductionUrl(config);
  }

  const password = options.password ?? process.env[config.auth.passwordEnvVar];
  if (!password) {
    throw new Error(`${config.auth.passwordEnvVar} environment variable not set`);
  }

  log(`Authenticating as ${config.auth.user}...`);

  const response = await fetch(`${baseUrl}${config.auth.endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: config.auth.user,
      password,
      deviceId
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed: ${response.status} - ${text}`);
  }

  const data = await response.json() as { ok: boolean; authKey?: string; error?: string };
  if (!data.ok || !data.authKey) {
    throw new Error(`Login failed: ${data.error || "No authKey returned"}`);
  }

  log("Authenticated");

  return {
    baseUrl,
    authKey: data.authKey,
    user: config.auth.user,
    deviceId
  };
}

// ============================================================================
// Admin Calls
// ============================================================================

/**
 * Call an admin endpoint with authentication.
 */
export async function callAdminEndpoint<T = unknown>(
  session: AuthSession,
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    log?: (message: string) => void;
  } = {}
): Promise<AdminCallResult<T>> {
  const { method = "POST", body, log = () => {} } = options;

  log(`Calling ${endpoint}...`);

  try {
    const headers: Record<string, string> = {
      "x-auth-user": session.user,
      "x-auth-device": session.deviceId,
      "x-auth-key": session.authKey
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${session.baseUrl}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        error: `${response.status} - ${text}`,
        statusCode: response.status
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json() as T;
      return { ok: true, data, statusCode: response.status };
    }

    // Non-JSON response
    const text = await response.text();
    return { ok: true, data: text as unknown as T, statusCode: response.status };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message
    };
  }
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if a remote server is healthy.
 */
export async function checkRemoteHealth(
  options: Omit<RemoteAdminOptions, "password"> = {}
): Promise<{ ok: boolean; url: string; error?: string }> {
  const config = options.config ?? opsConfig();
  const log = options.log ?? (() => {});

  let baseUrl: string;
  if (options.target) {
    baseUrl = options.target;
  } else if (options.local) {
    baseUrl = `http://localhost:${config.container.port}`;
  } else {
    baseUrl = await getProductionUrl(config);
  }

  log(`Checking health: ${baseUrl}${config.container.healthCheck.path}`);

  try {
    const response = await fetch(`${baseUrl}${config.container.healthCheck.path}`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return { ok: false, url: baseUrl, error: `HTTP ${response.status}` };
    }

    const text = await response.text();
    if (text.trim() !== config.container.healthCheck.expected) {
      return { ok: false, url: baseUrl, error: `Unexpected response: ${text}` };
    }

    return { ok: true, url: baseUrl };
  } catch (error) {
    return { ok: false, url: baseUrl, error: (error as Error).message };
  }
}

/**
 * Get the base URL of the production server.
 */
export async function getRemoteUrl(
  options: Omit<RemoteAdminOptions, "password"> = {}
): Promise<string> {
  const config = options.config ?? opsConfig();

  if (options.target) {
    return options.target;
  } else if (options.local) {
    return `http://localhost:${config.container.port}`;
  } else {
    return getProductionUrl(config);
  }
}
