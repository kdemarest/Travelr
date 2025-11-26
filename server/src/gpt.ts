import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getSecret } from "./secrets.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_MODEL = "gpt-4.1-mini";
const AVAILABLE_MODEL_CANDIDATES = [DEFAULT_MODEL, "gpt-4.1", "gpt-4o-mini"] as const;
const OPENAI_SECRET_NAME = "OPENAI_API_KEY";
const PROMPT_TEMPLATE_URL = new URL("./prompt-template.md", import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../../data");
const lastMessagePath = path.join(dataDir, "last_message.txt");

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
}

interface PromptTemplateContext {
  tripModel: unknown;
  userInput: string;
  conversationHistory?: string;
}

export async function sendChatCompletion(
  prompt: string,
  options: ChatCompletionOptions = {}
): Promise<{ text: string; raw: ChatCompletionResponse }> {
  const apiKey = await getOpenAIApiKey();
  const promptText = options.templateContext
    ? await buildPromptFromTemplate(options.templateContext)
    : prompt;
  const resolvedModel = resolveModel(options.model);
  const payload = buildPayload(promptText, { ...options, model: resolvedModel });
  await recordLastMessage(promptText);
  const response = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  const parsed = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
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
    temperature: 0
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

async function recordLastMessage(content: string): Promise<void> {
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(lastMessagePath, content, "utf-8");
  } catch (error) {
    console.warn("Failed to record last ChatGPT payload", error);
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
  return renderPromptTemplate(template, context);
}

async function getOpenAIApiKey(): Promise<string> {
  if (cachedApiKey) {
    return cachedApiKey;
  }
  const secret = await getSecret(OPENAI_SECRET_NAME);
  cachedApiKey = secret;
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

function renderPromptTemplate(template: string, context: PromptTemplateContext): string {
  const modelText = formatTripModel(context.tripModel);
  const userText = sanitizeUserInput(context.userInput);
  const historyText = formatConversationHistory(context.conversationHistory);
  return replaceTemplateToken(
    replaceTemplateToken(replaceTemplateToken(template, "{{tripModel}}", modelText), "{{conversationHistory}}", historyText),
    "{{userInput}}",
    userText
  );
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
