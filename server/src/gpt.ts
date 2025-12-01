import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getSecretOptional, isSecretAvailable } from "./secrets.js";
import { formatDaySummariesForPrompt } from "./day-summary.js";
import { isWebSearchAvailable } from "./search.js";
import { shouldWriteDiagnostics } from "./config.js";
import type { TripModel } from "./types.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_MODEL = "gpt-4.1";
const AVAILABLE_MODEL_CANDIDATES = [DEFAULT_MODEL, "gpt-5.1", "gpt-4.1-mini", "gpt-4o-mini"] as const;
const OPENAI_SECRET_NAME = "OPENAI_API_KEY";
const PROMPT_TEMPLATE_URL = new URL("../../dataConfig/prompt-template.md", import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const diagnosticsDir = path.resolve(__dirname, "../../dataDiagnostics");
const lastRequestPath = path.join(diagnosticsDir, "last_request.txt");
const lastResponsePath = path.join(diagnosticsDir, "last_response.txt");
const lastChatbotInputPath = path.join(diagnosticsDir, "last_chatbot_input.txt");

let cachedApiKey: string | null = null;
let promptTemplatePromise: Promise<string> | null = null;
let cachedPromptTemplate: string | null = null;
let activeModel: string = DEFAULT_MODEL;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  id: string;
  choices: Array<{
    index: number;
    finish_reason: string | null;
    message?: {
      role: string;
      content?: string;
    };
  }>;
};

interface ChatCompletionOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  templateContext?: PromptTemplateContext;
  skipRecording?: boolean;  // Skip writing last_*.txt files (for ping requests)
}

interface PromptTemplateContext {
  tripModel: unknown;
  userInput: string;
  conversationHistory?: string;
  focusSummary?: string;
  userPreferences?: unknown;
  markedActivities?: string[];
  markedDates?: string[];
}

export async function sendChatCompletion(
  prompt: string,
  options: ChatCompletionOptions = {}
): Promise<{ text: string; raw: ChatCompletionResponse }> {
  const apiKey = await getOpenAIApiKey();
  if (!apiKey) {
    throw new Error("ChatGPT is unavailable: OPENAI_API_KEY not configured.");
  }
  const promptText = options.templateContext
    ? await buildPromptFromTemplate(options.templateContext)
    : prompt;
  const resolvedModel = resolveModel(options.model);
  const payload = buildPayload(promptText, { ...options, model: resolvedModel });
  
  // Log the full chatbot input for debugging (skip for ping requests)
  if (!options.skipRecording) {
    await recordChatbotInput(promptText);
  }
  
  const response = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  const parsed = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!options.skipRecording) {
    await recordResponse(parsed);
  }
  if (!response.ok) {
    const hint = parsed?.choices?.[0]?.message?.content ?? JSON.stringify(parsed);
    throw new Error(`OpenAI request failed (${response.status}): ${hint}`);
  }

  const text = parsed?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI response did not include any content.");
  }

  return { text, raw: parsed };
}

export async function checkOpenAIConnection(): Promise<{ text: string }> {
  const result = await sendChatCompletion("Travelr connection check. Reply with 'pong'.", {
    systemPrompt: "You are performing a quick diagnostics ping. Respond with 'pong'.",
    temperature: 0,
    skipRecording: true  // Don't overwrite last_*.txt with ping requests
  });
  return { text: result.text };
}

export function getAvailableModels(): string[] {
  return [...new Set(AVAILABLE_MODEL_CANDIDATES)];
}

export function getActiveModel(): string {
  return activeModel;
}

export function setActiveModel(model: string): void {
  const normalized = model.trim();
  if (!normalized) {
    throw new Error("Model name cannot be empty.");
  }
  const available = getAvailableModels();
  if (!available.includes(normalized)) {
    throw new Error(`Model ${normalized} is not supported. Available: ${available.join(", ")}`);
  }
  activeModel = normalized;
}

export async function isOpenAIAvailable(): Promise<boolean> {
  const apiKey = await getOpenAIApiKey();
  return apiKey !== null;
}

function buildPayload(prompt: string, options: ChatCompletionOptions) {
  const messages: ChatMessage[] = [];
  if (options.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  return {
    model: options.model ?? getActiveModel(),
    messages,
    temperature: options.temperature ?? 0.2
  };
}

async function recordChatbotInput(promptText: string): Promise<void> {
  if (!shouldWriteDiagnostics()) return;
  try {
    await mkdir(diagnosticsDir, { recursive: true });
    await writeFile(lastChatbotInputPath, promptText, "utf-8");
  } catch (error) {
    console.warn("Failed to record chatbot input", error);
  }
}

export async function recordRequest(request: unknown): Promise<void> {
  if (!shouldWriteDiagnostics()) return;
  try {
    await mkdir(diagnosticsDir, { recursive: true });
    await writeFile(lastRequestPath, JSON.stringify(request, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to record request", error);
  }
}

async function recordResponse(response: unknown): Promise<void> {
  if (!shouldWriteDiagnostics()) return;
  try {
    await mkdir(diagnosticsDir, { recursive: true });
    await writeFile(lastResponsePath, JSON.stringify(response, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to record response", error);
  }
}


function buildHeaders(apiKey: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };
  const orgId = process.env.OPENAI_ORG_ID?.trim();
  if (orgId) {
    headers["OpenAI-Organization"] = orgId;
  }
  return headers;
}

export async function buildPromptFromTemplate(context: PromptTemplateContext): Promise<string> {
  const template = await loadPromptTemplate();
  return await renderPromptTemplate(template, context);
}

async function getOpenAIApiKey(): Promise<string | null> {
  if (cachedApiKey) {
    return cachedApiKey;
  }
  const secret = await getSecretOptional(OPENAI_SECRET_NAME);
  if (secret) {
    cachedApiKey = secret;
  }
  return secret;
}

async function loadPromptTemplate(): Promise<string> {
  if (cachedPromptTemplate) {
    return cachedPromptTemplate;
  }
  if (!promptTemplatePromise) {
    promptTemplatePromise = readFile(PROMPT_TEMPLATE_URL, "utf-8")
      .then((contents) => {
        cachedPromptTemplate = contents;
        return contents;
      })
      .catch((error) => {
        promptTemplatePromise = null;
        throw error;
      });
  }
  return promptTemplatePromise;
}

async function renderPromptTemplate(template: string, context: PromptTemplateContext): Promise<string> {
  const modelText = formatTripModel(context.tripModel);
  const daySummariesText = formatDaySummaries(context.tripModel);
  const userText = sanitizeUserInput(context.userInput);
  const historyText = formatConversationHistory(context.conversationHistory);
  const focusText = formatFocusSummary(context.focusSummary);
  const preferencesText = formatUserPreferences(context.userPreferences);
  const markedActivitiesText = formatMarkedList(context.markedActivities);
  const markedDatesText = formatMarkedList(context.markedDates);

  // Check web search availability for the template
  const webSearchAvailable = await isWebSearchAvailable();
  const websearchUnavailableText = webSearchAvailable 
    ? "" 
    : "   **⚠️ Web search is currently UNAVAILABLE (API keys not configured)**";

  let result = template;
  result = replaceTemplateToken(result, "{{tripModel}}", modelText);
  result = replaceTemplateToken(result, "{{daySummaries}}", daySummariesText);
  result = replaceTemplateToken(result, "{{conversationHistory}}", historyText);
  result = replaceTemplateToken(result, "{{focusSummary}}", focusText);
  result = replaceTemplateToken(result, "{{userInput}}", userText);
  result = replaceTemplateToken(result, "{{userPreferences}}", preferencesText);
  result = replaceTemplateToken(result, "{{markedActivities}}", markedActivitiesText);
  result = replaceTemplateToken(result, "{{markedDates}}", markedDatesText);
  result = replaceTemplateToken(result, "{{websearchUnavailable}}", websearchUnavailableText);
  return result;
}

function replaceTemplateToken(source: string, token: string, value: string): string {
  return source.split(token).join(value);
}

function formatTripModel(model: unknown): string {
  if (typeof model === "string") {
    return model.trim() || "(empty model)";
  }
  try {
    return JSON.stringify(model, null, 2);
  } catch {
    return String(model ?? "(no model)");
  }
}

function formatDaySummaries(model: unknown): string {
  if (!model || typeof model !== "object") {
    return "(no day summaries)";
  }
  const tripModel = model as TripModel;
  // Use pre-computed day summaries from finalized model
  const daySummaries = tripModel.daySummaries;
  if (!daySummaries || daySummaries.length === 0) {
    return "(no day summaries)";
  }
  return formatDaySummariesForPrompt(daySummaries);
}

function sanitizeUserInput(value: string): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function formatConversationHistory(value?: string): string {
  if (typeof value !== "string") {
    return "(no recent conversation)";
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : "(no recent conversation)";
}

const EMPTY_FOCUS_SUMMARY = {
  focusedDate: null,
  focusedActivityUid: null,
  markedActivities: [] as string[],
  markedDates: [] as string[]
};

function formatFocusSummary(value?: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return JSON.stringify(EMPTY_FOCUS_SUMMARY, null, 2);
  }
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed);
    const normalized = {
      focusedDate: parsed?.focusedDate ?? null,
      focusedActivityUid: parsed?.focusedActivityUid ?? null,
      markedActivities: Array.isArray(parsed?.markedActivities) ? parsed.markedActivities : [],
      markedDates: Array.isArray(parsed?.markedDates) ? parsed.markedDates : []
    };
    return JSON.stringify(normalized, null, 2);
  } catch {
    return trimmed;
  }
}

function formatMarkedList(values?: string[]): string {
  if (!Array.isArray(values) || values.length === 0) {
    return "(none)";
  }
  return values.join(", ");
}

function formatUserPreferences(value?: unknown): string {
  if (value === undefined) {
    return "{}";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : "{}";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function resolveModel(preferred?: string): string {
  const candidate = preferred?.trim();
  if (candidate && candidate.length > 0) {
    return candidate;
  }
  return getActiveModel();
}
const invokedDirectly = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
);

if (invokedDirectly) {
  (async () => {
    try {
      const result = await sendChatCompletion("Hello from Travelr!", {
        systemPrompt: "You are an upbeat travel-planning assistant.",
        temperature: 0.3
      });
      console.log("ChatGPT replied:\n", result.text);
    } catch (error) {
      console.error("ChatGPT first-light failed:", error);
      process.exitCode = 1;
    }
  })();
}
