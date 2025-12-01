/**
 * Secret management - reads API keys from environment variables.
 * 
 * Set these in your environment:
 *   OPENAI_API_KEY - ChatGPT API key
 *   GOOGLE_CS_API_KEY - Google Custom Search API key
 *   GOOGLE_CS_CX - Google Programmable Search Engine ID
 */

const cachedSecrets = new Map<string, string>();

// Required secrets and their purposes
const REQUIRED_SECRETS = [
  { name: "OPENAI_API_KEY", purpose: "ChatGPT integration" },
  { name: "GOOGLE_CS_API_KEY", purpose: "Web search" },
  { name: "GOOGLE_CS_CX", purpose: "Web search" }
];

export async function getSecret(secretName: string): Promise<string> {
  const value = await getSecretOptional(secretName);
  if (value) {
    return value;
  }
  const envVarName = secretName.toUpperCase().replace(/-/g, "_");
  throw new Error(`Secret ${secretName} not found. Set environment variable ${envVarName}.`);
}

export async function getSecretOptional(secretName: string): Promise<string | null> {
  const cached = cachedSecrets.get(secretName);
  if (cached) {
    return cached;
  }

  const envVarName = secretName.toUpperCase().replace(/-/g, "_");
  const envValue = process.env[envVarName]?.trim();
  if (envValue) {
    cachedSecrets.set(secretName, envValue);
    return envValue;
  }

  return null;
}

export async function checkSecretsOnStartup(): Promise<void> {
  console.log("Checking API keys...");
  for (const { name, purpose } of REQUIRED_SECRETS) {
    const value = await getSecretOptional(name);
    if (value) {
      console.log(`  ✓ ${name} (${purpose})`);
    } else {
      console.warn(`  ⚠ ${name} not found - ${purpose} will be unavailable`);
    }
  }
}

export async function isSecretAvailable(secretName: string): Promise<boolean> {
  const value = await getSecretOptional(secretName);
  return value !== null;
}
