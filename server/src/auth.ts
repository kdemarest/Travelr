/**
 * Simple authentication module with multi-device support.
 * 
 * - users.json: { username: { password, isAdmin } } pairs
 * - auths.json: { username: { deviceId: { authKey, label, city, firstSeen, lastSeen } } }
 * 
 * Auth flow:
 * 1. Client tries GET /auth?user=X&deviceId=Y&authKey=Z (cached key)
 * 2. If no cached key or invalid, client POSTs /auth with { user, password, deviceId, deviceInfo }
 * 3. On success, server returns { authKey } which client stores in localStorage
 * 4. All API requests include authKey, user, and deviceId in headers
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const DATA_DIR = process.env.DATA_USERS_DIR || path.join(process.cwd(), "dataUsers");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const AUTHS_FILE = path.join(DATA_DIR, "auths.json");

interface UserEntry {
  password: string;
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
type AuthsFile = Record<string, UserAuths>;   // user -> UserAuths

// Ensure directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Load users from file
function loadUsers(): UsersFile {
  try {
    const data = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Get password for a user (handles both old string format and new object format)
function getUserPassword(users: UsersFile, user: string): string | null {
  const entry = users[user];
  if (!entry) return null;
  if (typeof entry === "string") return entry;  // Old format
  return entry.password;  // New format
}

// Check if user is admin
function isUserAdmin(users: UsersFile, user: string): boolean {
  const entry = users[user];
  if (!entry) return false;
  if (typeof entry === "string") return false;  // Old format = not admin
  return entry.isAdmin === true;
}

// Export for use in admin routes
export function checkIsAdmin(user: string): boolean {
  const users = loadUsers();
  return isUserAdmin(users, user);
}

// Load auth keys from file
function loadAuths(): AuthsFile {
  try {
    const data = fs.readFileSync(AUTHS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Save auth keys to file
function saveAuths(auths: AuthsFile): void {
  ensureDataDir();
  fs.writeFileSync(AUTHS_FILE, JSON.stringify(auths, null, 2));
}

// Generate a random auth key
function generateAuthKey(): string {
  return "auth-" + randomBytes(32).toString("hex");
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
  user: string, 
  password: string, 
  deviceId: string, 
  deviceInfo: string,
  ip: string
): Promise<string | null> {
  const users = loadUsers();
  const storedHash = getUserPassword(users, user);
  
  if (!storedHash) {
    return null;
  }
  
  const isValid = await verifyPassword(password, storedHash);
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
  const auths = loadAuths();
  
  if (!auths[user]) {
    auths[user] = {};
  }
  
  const now = today();
  auths[user][deviceId] = {
    authKey,
    label: deviceInfo || "unknown device",
    city,
    firstSeen: auths[user][deviceId]?.firstSeen || now,
    lastSeen: now
  };
  
  saveAuths(auths);
  
  return authKey;
}

/**
 * Validate an existing authKey.
 * Returns the username if valid, null if invalid.
 * Also updates lastSeen.
 */
export function validateAuthKey(user: string, deviceId: string, authKey: string): string | null {
  if (!user || !deviceId || !authKey) {
    return null;
  }
  
  // Ensure proper prefixes
  if (!deviceId.startsWith("device-")) {
    deviceId = "device-" + deviceId;
  }
  if (!authKey.startsWith("auth-")) {
    return null;
  }
  
  const auths = loadAuths();
  const deviceAuth = auths[user]?.[deviceId];
  
  if (deviceAuth?.authKey === authKey) {
    // Update lastSeen
    deviceAuth.lastSeen = today();
    saveAuths(auths);
    return user;
  }
  
  return null;
}

/**
 * Logout a user's device by removing their auth key.
 */
export function logout(user: string, deviceId: string): void {
  if (!deviceId.startsWith("device-")) {
    deviceId = "device-" + deviceId;
  }
  
  const auths = loadAuths();
  if (auths[user]) {
    delete auths[user][deviceId];
    // Clean up empty user entries
    if (Object.keys(auths[user]).length === 0) {
      delete auths[user];
    }
    saveAuths(auths);
  }
}

/**
 * Get list of devices for a user.
 */
export function getDevices(user: string): Array<{ deviceId: string; label: string; city: string; firstSeen: string; lastSeen: string }> {
  const auths = loadAuths();
  const userAuths = auths[user] || {};
  
  return Object.entries(userAuths).map(([deviceId, auth]) => ({
    deviceId,
    label: auth.label,
    city: auth.city,
    firstSeen: auth.firstSeen,
    lastSeen: auth.lastSeen
  }));
}

/**
 * Check if auth is enabled (users.json has at least one user).
 */
export function isAuthEnabled(): boolean {
  const users = loadUsers();
  return Object.keys(users).length > 0;
}
