/**
 * Client-side authentication module with multi-device support.
 * 
 * Handles login, cached auth key validation, and API request authentication.
 * Each device gets a unique deviceId stored in localStorage.
 */

const AUTH_STORAGE_KEY = "travelr_auth";
const DEVICE_ID_KEY = "travelr_device_id";

interface AuthData {
  user: string;
  authKey: string;
}

// Get or create a unique device ID
function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    // Generate a random device ID
    const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    deviceId = `device-${randomPart}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

// Get device info string (OS / Browser)
function getDeviceInfo(): string {
  const ua = navigator.userAgent;
  
  // Detect OS
  let os = "Unknown";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("Mac")) os = "Mac";
  else if (ua.includes("Linux")) os = "Linux";
  
  // Detect browser
  let browser = "Browser";
  if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  
  return `${os} / ${browser}`;
}

// Get stored auth data from localStorage
function getStoredAuth(): AuthData | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Invalid JSON, clear it
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
  return null;
}

// Store auth data in localStorage
function storeAuth(auth: AuthData): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

// Clear stored auth data
export function clearAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

// Get current auth data (for adding to requests)
export function getAuth(): AuthData | null {
  return getStoredAuth();
}

// Check if the server requires authentication
export async function checkAuthRequired(): Promise<boolean> {
  try {
    const response = await fetch("/auth/status");
    const data = await response.json();
    return data.authRequired === true;
  } catch {
    // If we can't reach the server, assume auth is required
    return true;
  }
}

// Try to validate cached auth key
export async function tryAutoLogin(): Promise<AuthData | null> {
  const stored = getStoredAuth();
  if (!stored) {
    return null;
  }

  const deviceId = getDeviceId();

  try {
    const params = new URLSearchParams({
      user: stored.user,
      deviceId,
      authKey: stored.authKey
    });
    const response = await fetch(`/auth?${params}`);
    if (response.ok) {
      return stored;
    }
  } catch {
    // Network error, keep stored auth for retry
    return null;
  }

  // Auth key is invalid, clear it
  clearAuth();
  return null;
}

// Login with username and password
export async function login(user: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const deviceId = getDeviceId();
  const deviceInfo = getDeviceInfo();

  try {
    const response = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password, deviceId, deviceInfo })
    });

    const data = await response.json();

    if (data.ok && data.authKey) {
      storeAuth({ user: data.user, authKey: data.authKey });
      return { ok: true };
    }

    return { ok: false, error: data.error || "Login failed" };
  } catch (error) {
    return { ok: false, error: "Network error" };
  }
}

// Logout
export async function logout(): Promise<void> {
  const stored = getStoredAuth();
  const deviceId = getDeviceId();
  
  if (stored) {
    try {
      const params = new URLSearchParams({
        user: stored.user,
        deviceId
      });
      await fetch(`/auth/logout?${params}`, { method: "POST" });
    } catch {
      // Ignore network errors on logout
    }
  }
  clearAuth();
}

// Add auth headers to a fetch request
export function addAuthHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const auth = getStoredAuth();
  const deviceId = getDeviceId();
  
  if (auth) {
    headers["X-Auth-User"] = auth.user;
    headers["X-Auth-Key"] = auth.authKey;
    headers["X-Auth-Device"] = deviceId;
  }
  return headers;
}

// Wrapper for fetch that adds auth headers
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const auth = getStoredAuth();
  const deviceId = getDeviceId();
  
  if (auth) {
    headers.set("X-Auth-User", auth.user);
    headers.set("X-Auth-Key", auth.authKey);
    headers.set("X-Auth-Device", deviceId);
  }
  
  return fetch(url, { ...options, headers });
}
