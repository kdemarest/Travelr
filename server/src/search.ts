import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { getSecretOptional } from "./secrets.js";
import { shouldWriteDiagnostics } from "./config.js";

const CUSTOM_SEARCH_ENDPOINT = new URL("https://www.googleapis.com/customsearch/v1");
const MAX_RESULTS = 8;
const GOOGLE_API_KEY_SECRET = "GOOGLE_CS_API_KEY";
const GOOGLE_CX_SECRET = "GOOGLE_CS_CX";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const diagnosticsDir = path.resolve(__dirname, "../../dataDiagnostics");
const lastSearchHtmlPath = path.join(diagnosticsDir, "last_search_result.html");

type CustomSearchItem = {
  title?: string;
  snippet?: string;
  link?: string;
};

type CustomSearchResponse = {
  items?: CustomSearchItem[];
  error?: {
    message?: string;
  };
};

export type GoogleSearchResult = {
  query: string;
  snippets: string[];
};

export async function handleGoogleSearch(query: string): Promise<GoogleSearchResult> {
  const [apiKey, cx] = await Promise.all([getGoogleApiKey(), getGoogleCx()]);
  if (!apiKey || !cx) {
    throw new Error("Web search is unavailable: Google API keys not configured.");
  }
  const endpoint = new URL(CUSTOM_SEARCH_ENDPOINT.href);
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("cx", cx);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("num", String(MAX_RESULTS));
  endpoint.searchParams.set("gl", "us");
  endpoint.searchParams.set("hl", "en");

  console.log("Google Custom Search request", {
    query,
    endpoint: endpoint.toString()
  });
  const response = await fetch(endpoint);
  console.log("Google Custom Search response", {
    query,
    status: response.status,
    ok: response.ok
  });
  const rawText = await response.text();

  let payload: CustomSearchResponse;
  try {
    payload = JSON.parse(rawText) as CustomSearchResponse;
  } catch (error) {
    console.warn("Failed to parse Custom Search payload", { query, error });
    await recordLastSearchPayload(query, rawText);
    throw new Error(`Custom Search response was not valid JSON (${error instanceof Error ? error.message : error}).`);
  }

  await recordLastSearchPayload(query, payload);

  if (response.status === 429) {
    throw new Error("Google Custom Search is rate limiting the requests.");
  }

  if (!response.ok) {
    const hint = payload?.error?.message ?? `status ${response.status}`;
    console.warn("Custom Search returned error", { query, hint, status: response.status });
    throw new Error(`Custom Search request failed: ${hint}`);
  }

  const snippets = extractSnippets(payload?.items).slice(0, MAX_RESULTS);
  console.log("Custom Search parsed snippets", { query, snippetCount: snippets.length });
  return { query, snippets };
}

function extractSnippets(items?: CustomSearchItem[]): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      const title = item.title?.trim();
      const link = item.link?.trim();
      if (!title || !link) {
        return null;
      }
      const summary = item.snippet?.replace(/\s+/g, " ").trim();
      return summary ? `${title} — ${summary} (${link})` : `${title} (${link})`;
    })
    .filter((line): line is string => Boolean(line));
}

async function recordLastSearchPayload(query: string, payload: unknown): Promise<void> {
  if (!shouldWriteDiagnostics()) return;
  try {
    await mkdir(diagnosticsDir, { recursive: true });
    const header = `<!-- query: ${query.replace(/-->/g, "")} | timestamp: ${new Date().toISOString()} -->\n`;
    const serialized =
      typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) ?? "(no payload)";
    const htmlBody = `<pre>${escapeHtml(serialized)}</pre>`;
    await writeFile(lastSearchHtmlPath, `${header}${htmlBody}`, "utf-8");
  } catch (error) {
    console.warn("Failed to record last Google search payload", error);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let cachedApiKey: string | null = null;
let cachedCx: string | null = null;
let apiKeyChecked = false;
let cxChecked = false;

async function getGoogleApiKey(): Promise<string | null> {
  if (!apiKeyChecked) {
    cachedApiKey = await getSecretOptional(GOOGLE_API_KEY_SECRET);
    apiKeyChecked = true;
  }
  return cachedApiKey;
}

async function getGoogleCx(): Promise<string | null> {
  if (!cxChecked) {
    cachedCx = await getSecretOptional(GOOGLE_CX_SECRET);
    cxChecked = true;
  }
  return cachedCx;
}

export async function isWebSearchAvailable(): Promise<boolean> {
  const [apiKey, cx] = await Promise.all([getGoogleApiKey(), getGoogleCx()]);
  return Boolean(apiKey && cx);
}
