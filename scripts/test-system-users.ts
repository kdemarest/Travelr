/**
 * Test login for all system users.
 * Usage: npx tsx scripts/test-system-users.ts
 */

const SYSTEM_USERS = [
  { userId: "admin", pwdEnvVar: "TRAVELR_ADMIN_PWD" },
  { userId: "deploybot", pwdEnvVar: "TRAVELR_DEPLOYBOT_PWD" },
  { userId: "testbot", pwdEnvVar: "TRAVELR_TESTBOT_PWD" },
];

const BASE_URL = "http://localhost:4000";

async function testLogin(userId: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${BASE_URL}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: userId,
        password,
        deviceId: "test-system-users",
        deviceInfo: "test script"
      })
    });
    
    if (response.ok) {
      const data = await response.json() as { authKey?: string };
      return { ok: !!data.authKey };
    } else {
      return { ok: false, error: `HTTP ${response.status}` };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function main() {
  console.log("Testing system user logins against", BASE_URL);
  console.log("=".repeat(50));
  
  for (const { userId, pwdEnvVar } of SYSTEM_USERS) {
    const pwd = process.env[pwdEnvVar];
    if (!pwd) {
      console.log(`${userId}: SKIP (${pwdEnvVar} not set)`);
      continue;
    }
    
    const result = await testLogin(userId, pwd);
    if (result.ok) {
      console.log(`${userId}: OK`);
    } else {
      console.log(`${userId}: FAIL - ${result.error}`);
    }
  }
}

main();
