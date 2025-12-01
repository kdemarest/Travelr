/**
 * hashPassword.ts - Generate a scrypt hash for a password
 * 
 * Usage:
 *   npx ts-node scripts/hashPassword.ts <password>
 *   npx ts-node scripts/hashPassword.ts mySecretPassword
 * 
 * Output can be pasted directly into users.json
 */

import { scrypt, randomBytes } from "node:crypto";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

async function main() {
  const password = process.argv[2];
  
  if (!password) {
    console.error("Usage: npx ts-node scripts/hashPassword.ts <password>");
    process.exit(1);
  }
  
  const hash = await hashPassword(password);
  console.log(`\nPassword: ${password}`);
  console.log(`Hash:     ${hash}`);
  console.log(`\nFor users.json:`);
  console.log(`  "username": { "password": "${hash}", "isAdmin": false }`);
}

main();
