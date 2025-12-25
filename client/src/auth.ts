/**
 * Client-side authentication module with multi-device support.
 * 
 * Handles login, cached auth key validation, and API request authentication.
 * Each device gets a unique deviceId stored in localStorage.
 */

import { clientDataCache, type ClientDataCacheData } from "./client-data-cache";

const AUTH_STORAGE_KEY = "travelr_auth";
const DEVICE_ID_KEY = "travelr_device_id";

interface AuthData {
  user: string;
  authKey: string;
}

// Callback for when auth fails (401 response)
type AuthFailureCallback = () => void;
let onAuthFailure: AuthFailureCallback | null = null;

/**
 * Register a callback to be called when an API request returns 401.
 * This allows the app to show the login screen when auth is invalid.
 */
export function setAuthFailureHandler(callback: AuthFailureCallback | null): void {
  onAuthFailure = callback;
}

/**
 * Trigger the auth failure handler (clears auth and notifies listeners).
 */
function triggerAuthFailure(): void {
  clearAuth();
  if (onAuthFailure) {
    onAuthFailure();
  }
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
//    console.log("[checkAuthRequired] server response:", data);
    return data.authRequired === true;
  } catch (e) {
    // If we can't reach the server, assume auth is required
    console.log("[checkAuthRequired] error:", e);
    return true;
  }
}

// Try to validate cached auth key, returns lastTripId from server if available
export async function tryAutoLogin(): Promise<{ auth: AuthData; lastTripId: string | null } | null> {
  const stored = getStoredAuth();
//  console.log("[tryAutoLogin] stored auth:", stored);
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
//    console.log("[tryAutoLogin] validating with server...");
    const response = await fetch(`/auth?${params}`);
//    console.log("[tryAutoLogin] response ok:", response.ok);
    if (response.ok) {
      const data = await response.json() as { 
        lastTripId?: string; 
        clientDataCache?: ClientDataCacheData;
      };
//      console.log("[tryAutoLogin] FULL server response data:", JSON.stringify(data));
//      console.log("[tryAutoLogin] server returned lastTripId:", data.lastTripId);
//      console.log("[tryAutoLogin] server returned clientDataCache:", data.clientDataCache);
//      console.log("[tryAutoLogin] clientDataCache keys:", data.clientDataCache ? Object.keys(data.clientDataCache) : "NONE");
      
      // Update client data cache if provided
      if (data.clientDataCache) {
//        console.log("[tryAutoLogin] calling clientDataCache.update...");
        clientDataCache.update(data.clientDataCache);
//        console.log("[tryAutoLogin] after update, modelList:", clientDataCache.get("modelList"));
      } else {
        console.log("[tryAutoLogin] NO clientDataCache in response!");
      }
      
      return { auth: stored, lastTripId: data.lastTripId || null };
    }
  } catch (e) {
    // Network error, keep stored auth for retry
    console.log("[tryAutoLogin] network error:", e);
    return null;
  }

  // Auth key is invalid, clear it
  console.log("[tryAutoLogin] auth invalid, clearing");
  clearAuth();
  return null;
}

// Login with username and password
export async function login(user: string, password: string): Promise<{ ok: boolean; error?: string; lastTripId?: string }> {
  const deviceId = getDeviceId();
  const deviceInfo = getDeviceInfo();

  try {
    const response = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password, deviceId, deviceInfo })
    });

    const data = await response.json() as {
      ok?: boolean;
      user?: string;
      authKey?: string;
      lastTripId?: string;
      error?: string;
      clientDataCache?: ClientDataCacheData;
    };

    if (data.ok && data.authKey) {
      storeAuth({ user: data.user!, authKey: data.authKey });
      
      // Update client data cache if provided
      if (data.clientDataCache) {
        clientDataCache.update(data.clientDataCache);
      }
      
      return { ok: true, lastTripId: data.lastTripId };
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

// Wrapper for fetch that adds auth headers and handles 401 responses
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const auth = getStoredAuth();
  const deviceId = getDeviceId();
  
  //console.log("[authFetch] auth:", auth, "deviceId:", deviceId);
  
  if (auth) {
    headers.set("X-Auth-User", auth.user);
    headers.set("X-Auth-Key", auth.authKey);
    headers.set("X-Auth-Device", deviceId);
  }
  
  const response = await fetch(url, { ...options, headers });
  
  // If we get a 401, the auth token is invalid - trigger re-authentication
  if (response.status === 401) {
    console.log("[authFetch] 401 response - triggering auth failure");
    triggerAuthFailure();
  }
  
  return response;
}
