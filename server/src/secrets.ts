import type { Credential } from "@strychnine-labs/windows-credential-manager";

const SERVICE_NAME = "TRAVELR";

type CredentialManagerModule = typeof import("@strychnine-labs/windows-credential-manager");
type CredentialManagerCtor = new () => CredentialManagerAdapter;

type CredentialManagerAdapter = {
  getCredential(target: string, credentialType?: string): Credential;
  listCredentials(): Credential[];
};

const cachedSecrets = new Map<string, string>();
let credentialManagerPromise: Promise<CredentialManagerAdapter | null> | null = null;

export async function getSecret(secretName: string): Promise<string> {
  const cached = cachedSecrets.get(secretName);
  if (cached) {
    return cached;
  }

  const credential = await readCredentialFromWindows(buildCredentialTarget(secretName), secretName);
  if (credential?.password) {
    const sanitized = sanitizeCredentialSecret(credential.password);
    if (sanitized) {
      cachedSecrets.set(secretName, sanitized);
      return sanitized;
    }
    console.warn(`Credential ${secretName} was present but empty after sanitization.`);
  }

  throw new Error(`Credential ${secretName} not found in Windows Credential Manager (${SERVICE_NAME}/${secretName}).`);
}

function buildCredentialTarget(secretName: string): string {
  return `${SERVICE_NAME}\\${secretName}`;
}

async function readCredentialFromWindows(target: string, secretName: string): Promise<Credential | null> {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const manager = await getCredentialManager();
    if (!manager) {
      return null;
    }

    try {
      const direct = manager.getCredential(target, "GENERIC");
      if (direct?.password) {
        return direct;
      }
    } catch (error) {
      console.warn(`Direct credential lookup failed for ${target}`, error);
    }

    const fallback = manager
      .listCredentials()
      .find((cred) => {
        const normalizedTarget = extractTargetName(cred.targetName);
        const normalizedExpected = extractTargetName(target);
        const targetParts = splitCredentialTarget(normalizedTarget);
        const expectedParts = splitCredentialTarget(normalizedExpected);

        if (
          targetParts.service &&
          expectedParts.service &&
          targetParts.secret &&
          expectedParts.secret &&
          equalsIgnoreCase(targetParts.service, expectedParts.service) &&
          equalsIgnoreCase(targetParts.secret, expectedParts.secret)
        ) {
          return true;
        }

        const candidateSecret = targetParts.secret ?? cred.username;
        return (
          equalsIgnoreCase(targetParts.service, SERVICE_NAME) && equalsIgnoreCase(candidateSecret, secretName)
        );
      });

    return fallback ?? null;
  } catch (error) {
    console.warn("Failed to read credential from Windows Credential Manager", error);
    return null;
  }
}

function extractTargetName(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const marker = "target=";
  const index = value.lastIndexOf(marker);
  if (index === -1) {
    return value;
  }
  return value.slice(index + marker.length);
}

function splitCredentialTarget(value?: string | null): { service?: string | null; secret?: string | null } {
  if (!value) {
    return {};
  }
  const sanitized = value.replace(/^LegacyGeneric:target=/i, "");

  const slashParts = sanitized.split(/[\\/]/).filter(Boolean);
  if (slashParts.length >= 2) {
    return { service: slashParts[0], secret: slashParts.slice(1).join("/") };
  }

  const atIndex = sanitized.lastIndexOf("@");
  if (atIndex > 0) {
    const secret = sanitized.slice(0, atIndex);
    const service = sanitized.slice(atIndex + 1);
    return { service, secret };
  }

  return { service: sanitized };
}

function equalsIgnoreCase(a?: string | null, b?: string | null): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

function sanitizeCredentialSecret(secret: string): string {
  const withoutCarriageReturns = secret.replace(/\r/g, "");
  const withoutLegacySuffix = withoutCarriageReturns.replace(/LegacyGeneric:target=.*$/s, "");
  const newlineTrimmed = withoutLegacySuffix.split("\n")[0] ?? "";
  return newlineTrimmed.trim();
}

async function getCredentialManager(): Promise<CredentialManagerAdapter | null> {
  if (!credentialManagerPromise) {
    credentialManagerPromise = import("@strychnine-labs/windows-credential-manager")
      .then((module) => {
        const { CredentialManager } = module as CredentialManagerModule;
        return new (CredentialManager as unknown as CredentialManagerCtor)();
      })
      .catch((error) => {
        console.warn("Unable to initialize CredentialManager", error);
        return null;
      });
  }
  return credentialManagerPromise;
}
