/**
 * Simple authentication module with multi-device support.
 * 
 * - users.json: { userId: { passwordHash, isAdmin } } pairs
 * - auths.json: { userId: { deviceId: { authKey, label, city, firstSeen, lastSeen } } }
 * 
 * Auth flow:
 * 1. Client tries GET /auth?userId=X&deviceId=Y&authKey=Z (cached key)
 * 2. If no cached key or invalid, client POSTs /auth with { userId, password, deviceId, deviceInfo }
 * 3. On success, server returns { authKey } which client stores in localStorage
 * 4. All API requests include authKey, userId, and deviceId in headers
 */

import path from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { LazyFile } from "./lazy-file.js";
import { User } from "./user.js";
import { ClientDataCache } from "./client-data-cache.js";
import { Paths } from "./data-paths.js";

const USERS_FILE = path.join(Paths.dataUsers, "users.json");
const AUTHS_FILE = path.join(Paths.dataUsers, "auths.json");
const USER_STATE_FILE = path.join(Paths.dataUsers, "userState.json");

// Per-user state (survives across devices)
interface UserState {
  lastTripId?: string;
}
type UserStateFile = Record<string, UserState>;

interface UserEntry {
  passwordHash: string;
  isAdmin?: boolean;
}

interface DeviceAuth {
  authKey: string;
  label: string;
  city: string;
  firstSeen: string;
  lastSeen: string;
}

type UsersFile = Record<string, UserEntry | string>;  // Support both old and new format
type UserAuths = Record<string, DeviceAuth>;  // deviceId -> DeviceAuth
type AuthsFile = Record<string, UserAuths>;   // userId -> UserAuths

// JSON helpers
const parseJson = <T>(text: string): T => JSON.parse(text);
const toJson = <T>(data: T): string => JSON.stringify(data, null, 2);

// LazyFile instances for each data file
const usersFile = new LazyFile<UsersFile>(USERS_FILE, {}, parseJson, toJson);
const authsFile = new LazyFile<AuthsFile>(AUTHS_FILE, {}, parseJson, toJson);
const userStateFile = new LazyFile<UserStateFile>(USER_STATE_FILE, {}, parseJson, toJson);

// O(1) lookup cache for Bearer token auth: authKey -> {userId, deviceId}
const authKeyCache = new Map<string, { userId: string; deviceId: string }>();

// ============================================================================
// System Users (defined by env vars, never stored in users.json)
// ============================================================================

interface SystemUser {
  userId: string;
  pwdEnvVar: string;      // Plaintext password (dev)
  hashEnvVar: string;     // Pre-hashed password (prod)
  isAdmin: boolean;
}

const SYSTEM_USERS: SystemUser[] = [
  { userId: "admin", pwdEnvVar: "TRAVELR_ADMIN_PWD", hashEnvVar: "TRAVELR_ADMIN_PWDHASH", isAdmin: true },
  { userId: "deploybot", pwdEnvVar: "TRAVELR_DEPLOYBOT_PWD", hashEnvVar: "TRAVELR_DEPLOYBOT_PWDHASH", isAdmin: true },
  { userId: "testbot", pwdEnvVar: "TRAVELR_TESTBOT_PWD", hashEnvVar: "TRAVELR_TESTBOT_PWDHASH", isAdmin: false },
];

// Cache for system user hashes (computed once from _PWD env vars)
const systemUserHashCache = new Map<string, string>();

// ============================================================================
// Unified User Record Lookup
// ============================================================================

/**
 * The single source of truth for user records.
 * Returns a UserEntry for any user - system user or file user.
 * For system users, constructs the record from env vars.
 * For file users, looks up in users.json.
 * Returns null if user doesn't exist or has no password configured.
 */
async function getUserRecord(userId: string): Promise<UserEntry | null> {
  // Check system users first
  const su = SYSTEM_USERS.find(s => s.userId === userId);
  if (su) {
    const hash = await getSystemUserHashInternal(su);
    if (!hash) return null;
    return { passwordHash: hash, isAdmin: su.isAdmin };
  }
  
  // File users
  const entry = usersFile.data[userId];
  if (!entry) return null;
  
  // Handle legacy string format (hash only, not admin)
  if (typeof entry === "string") {
    return { passwordHash: entry, isAdmin: false };
  }
  
  return entry;
}

/**
 * Get password hash for a system user from env vars.
 * Checks _PWDHASH first (prod), then hashes _PWD on demand (dev).
 * Returns null if neither env var is set.
 */
async function getSystemUserHashInternal(su: SystemUser): Promise<string | null> {
  // Check for pre-computed hash first (production)
  const hashFromEnv = process.env[su.hashEnvVar];
  if (hashFromEnv) {
    return hashFromEnv;
  }
  
  // Check cache (avoid re-hashing on every auth)
  const cached = systemUserHashCache.get(su.userId);
  if (cached) {
    return cached;
  }
  
  // Hash from plaintext password (dev)
  const pwd = process.env[su.pwdEnvVar];
  if (pwd) {
    const hash = await hashPassword(pwd);
    systemUserHashCache.set(su.userId, hash);
    return hash;
  }
  
  return null;
}

/**
 * Rebuild the authKey cache from authsFile data.
 */
function rebuildAuthKeyCache(): void {
  authKeyCache.clear();
  const auths = authsFile.data;
  for (const [userId, devices] of Object.entries(auths)) {
    for (const [deviceId, deviceAuth] of Object.entries(devices)) {
      authKeyCache.set(deviceAuth.authKey, { userId, deviceId });
    }
  }
}

/**
 * Initialize the auth module. Call once at startup.
 */
export function initAuth(): void {
  usersFile.load();
  authsFile.load();
  userStateFile.load();
  rebuildAuthKeyCache();
}

/**
 * Flush all pending writes. Call on shutdown.
 */
export function flushAuth(): void {
  usersFile.flush();
  authsFile.flush();
  userStateFile.flush();
}

// Check if user is admin (async - uses getUserRecord)
async function isUserAdminAsync(userId: string): Promise<boolean> {
  const record = await getUserRecord(userId);
  return record?.isAdmin === true;
}

// Sync version for places that can't await (uses cached data only)
function isUserAdminSync(userId: string): boolean {
  // Check system users first
  const su = SYSTEM_USERS.find(s => s.userId === userId);
  if (su) {
    return su.isAdmin;
  }
  // File users
  const entry = usersFile.data[userId];
  if (!entry) return false;
  if (typeof entry === "string") return false;
  return entry.isAdmin === true;
}

// Export for use in admin routes
export function checkIsAdmin(userId: string): boolean {
  return isUserAdminSync(userId);
}

// Generate a random auth key
function generateAuthKey(): string {
  return "auth-" + randomBytes(32).toString("hex");
}

/**
 * Get the last trip ID for a user.
 */
export function getLastTripId(userId: string): string | null {
  const state = userStateFile.data;
  return state[userId]?.lastTripId ?? null;
}

/**
 * Set the last trip ID for a user.
 * Only marks dirty if the value actually changed.
 */
export function setLastTripId(userId: string, tripId: string): void {
  const state = userStateFile.data;
  
  // Only mark dirty if the value is different
  if (state[userId]?.lastTripId === tripId) {
    return;
  }
  
  if (!state[userId]) {
    state[userId] = {};
  }
  state[userId].lastTripId = tripId;
  userStateFile.setDirty();
}

// ============================================================================
// Password Hashing (scrypt)
// ============================================================================

/**
 * Hash a password using scrypt. Returns "salt:hash" format.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(timingSafeEqual(Buffer.from(hash, "hex"), derivedKey));
    });
  });
}

// Get current date as ISO string (date only)
function today(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Lookup city from IP address using ip-api.com (free, no key needed)
 */
async function lookupCity(ip: string): Promise<string> {
  // Skip lookup for localhost/private IPs
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return "localhost";
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=city,country`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json() as { city?: string; country?: string };
      if (data.city) {
        return data.country ? `${data.city}, ${data.country}` : data.city;
      }
    }
  } catch {
    // Ignore lookup failures
  }
  return "unknown";
}

/**
 * Validate a username/password combination.
 * Returns an authKey if valid, null if invalid.
 */
export async function login(
  userId: string, 
  password: string, 
  deviceId: string, 
  deviceInfo: string,
  ip: string
): Promise<string | null> {
  const userRecord = await getUserRecord(userId);
  if (!userRecord) {
    return null;
  }
  
  const isValid = await verifyPassword(password, userRecord.passwordHash);
  if (!isValid) {
    return null;
  }
  
  // Ensure deviceId has proper prefix
  if (!deviceId.startsWith("device-")) {
    deviceId = "device-" + deviceId;
  }
  
  // Lookup city from IP
  const city = await lookupCity(ip);
  
  // Generate and store auth key
  const authKey = generateAuthKey();
  const auths = authsFile.data;
  
  if (!auths[userId]) {
    auths[userId] = {};
  }
  
  const now = today();
  
  // Remove old authKey from cache if replacing
  const oldAuth = auths[userId]?.[deviceId];
  if (oldAuth) {
    authKeyCache.delete(oldAuth.authKey);
  }
  
  auths[userId][deviceId] = {
    authKey,
    label: deviceInfo || "unknown device",
    city,
    firstSeen: auths[userId][deviceId]?.firstSeen || now,
    lastSeen: now
  };
  
  // Add new authKey to cache
  authKeyCache.set(authKey, { userId, deviceId });
  
  authsFile.setDirty();
  
  return authKey;
}

/**
 * Authentication result from authenticateAndFetchUser.
 */
export interface AuthResult {
  valid: boolean;
  user: User | null;
}

/**
 * Validate an existing authKey and return the authenticated user.
 * Also updates lastSeen on successful auth.
 * 
 * If deviceId is not provided, auth will still work but lastSeen won't be updated.
 */
export function authenticateAndFetchUser(userId: string, deviceId: string | undefined, authKey: string): AuthResult {
  if (!userId || !authKey) {
    return { valid: false, user: null };
  }
  
  // Ensure proper prefixes
  if (deviceId && !deviceId.startsWith("device-")) {
    deviceId = "device-" + deviceId;
  }
  if (!authKey.startsWith("auth-")) {
    return { valid: false, user: null };
  }
  
  const auths = authsFile.data;
  
  // If deviceId provided, check that specific device
  if (deviceId) {
    const deviceAuth = auths[userId]?.[deviceId];
    
    if (deviceAuth?.authKey === authKey) {
      // Update lastSeen
      deviceAuth.lastSeen = today();
      authsFile.setDirty();
      
      return {
        valid: true,
        user: new User(userId, isUserAdminSync(userId), new ClientDataCache())
      };
    }
  } else {
    // No deviceId - check if authKey matches ANY device for this user
    const userAuths = auths[userId];
    if (userAuths) {
      for (const deviceAuth of Object.values(userAuths)) {
        if (deviceAuth.authKey === authKey) {
          // Valid auth, but don't update lastSeen without knowing which device
          return {
            valid: true,
            user: new User(userId, isUserAdminSync(userId), new ClientDataCache())
          };
        }
      }
    }
  }
  
  return { valid: false, user: null };
}

/**
 * Logout a user's device by removing their auth key.
 */
export function logout(userId: string, deviceId: string): void {
  if (!deviceId.startsWith("device-")) {
    deviceId = "device-" + deviceId;
  }
  
  const auths = authsFile.data;
  if (auths[userId]?.[deviceId]) {
    // Remove from cache
    authKeyCache.delete(auths[userId][deviceId].authKey);
    
    delete auths[userId][deviceId];
    // Clean up empty user entries
    if (Object.keys(auths[userId]).length === 0) {
      delete auths[userId];
    }
    authsFile.setDirty();
  }
}

/**
 * Get list of devices for a user.
 */
export function getDevices(userId: string): Array<{ deviceId: string; label: string; city: string; firstSeen: string; lastSeen: string }> {
  const auths = authsFile.data;
  const userAuths = auths[userId] || {};
  
  return Object.entries(userAuths).map(([deviceId, auth]) => ({
    deviceId,
    label: auth.label,
    city: auth.city,
    firstSeen: auth.firstSeen,
    lastSeen: auth.lastSeen
  }));
}

/**
 * Authenticate using a Bearer token (authKey only, no user/device needed).
 * Uses O(1) cache lookup. Returns User if valid, null if invalid.
 */
export function authenticateWithBearerToken(authKey: string): User | null {
  if (!authKey) {
    return null;
  }
  
  const cached = authKeyCache.get(authKey);
  if (!cached) {
    return null;
  }
  
  const { userId, deviceId } = cached;
  
  // Update lastSeen
  const auths = authsFile.data;
  const deviceAuth = auths[userId]?.[deviceId];
  if (deviceAuth) {
    deviceAuth.lastSeen = today();
    authsFile.setDirty();
  }
  
  return new User(userId, isUserAdminSync(userId), new ClientDataCache());
}

/**
 * Check if the auth system is properly configured.
 * Requires admin user to be configured (TRAVELR_ADMIN_PWD or TRAVELR_ADMIN_PWDHASH).
 * If this returns false, the server should refuse to start.
 */
export function isAuthConfigured(): boolean {
  // Admin user is required
  const adminUser = SYSTEM_USERS.find(su => su.userId === "admin");
  if (!adminUser) {
    console.error("[isAuthConfigured] FATAL: No admin user defined in SYSTEM_USERS");
    return false;
  }
  
  const hasAdmin = !!(process.env[adminUser.hashEnvVar] || process.env[adminUser.pwdEnvVar]);
  
  if (!hasAdmin) {
    console.error("[isAuthConfigured] FATAL: Admin user not configured.");
    console.error(`  - Set ${adminUser.pwdEnvVar} (dev) or ${adminUser.hashEnvVar} (prod)`);
  }
  
  return hasAdmin;
}

/**
 * Authenticate a user directly with password (no device/authKey required).
 * Useful for single API calls from scripts or automation.
 * Returns a User object if valid, null if invalid.
 */
export async function authenticateWithPassword(userId: string, password: string): Promise<User | null> {
  const result = await authenticateWithPasswordDebug(userId, password);
  return result.user;
}

/**
 * Debug version of authenticateWithPassword that returns detailed info about why auth failed.
 */
export async function authenticateWithPasswordDebug(userId: string, password: string): Promise<{
  user: User | null;
  debug: Record<string, unknown>;
}> {
  const debug: Record<string, unknown> = {
    userId,
    passwordProvided: !!password,
    passwordLength: password?.length ?? 0,
  };

  if (!userId || !password) {
    debug.failReason = "Missing userId or password";
    debug.stack = new Error().stack;
    return { user: null, debug };
  }

  const userRecord = await getUserRecord(userId);
  debug.userRecordFound = !!userRecord;
  
  if (!userRecord) {
    debug.failReason = "User record not found";
    debug.stack = new Error().stack;
    // Check if it's a system user and why it might have failed
    const su = SYSTEM_USERS.find(s => s.userId === userId);
    if (su) {
      debug.isSystemUser = true;
      debug.hashEnvVar = su.hashEnvVar;
      debug.pwdEnvVar = su.pwdEnvVar;
      debug.hashEnvVarSet = !!process.env[su.hashEnvVar];
      debug.hashEnvVarLength = process.env[su.hashEnvVar]?.length ?? 0;
      debug.hashEnvVarPreview = process.env[su.hashEnvVar] ? process.env[su.hashEnvVar]!.substring(0, 20) + "..." : null;
      debug.pwdEnvVarSet = !!process.env[su.pwdEnvVar];
    } else {
      debug.isSystemUser = false;
    }
    return { user: null, debug };
  }

  debug.hashLength = userRecord.passwordHash?.length ?? 0;
  debug.hashPreview = userRecord.passwordHash ? userRecord.passwordHash.substring(0, 20) + "..." : null;
  debug.hashFormat = userRecord.passwordHash?.includes(":") ? "salt:hash" : "unknown";
  debug.isAdmin = userRecord.isAdmin;

  try {
    const valid = await verifyPassword(password, userRecord.passwordHash);
    debug.passwordValid = valid;
    
    if (!valid) {
      debug.failReason = "Password verification failed";
      debug.stack = new Error().stack;
      return { user: null, debug };
    }

    return { 
      user: new User(userId, userRecord.isAdmin === true, new ClientDataCache()),
      debug: { ...debug, success: true }
    };
  } catch (err) {
    debug.failReason = "Password verification threw error";
    debug.error = err instanceof Error ? err.message : String(err);
    debug.stack = err instanceof Error ? err.stack : new Error().stack;
    return { user: null, debug };
  }
}
