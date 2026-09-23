import crypto from "crypto";
import OpenAI from "openai";
import { config } from "../config.js";
import type { ChatMessage } from "../types.js";
import { buildSystemPrompt } from "./faq.js";
import { getRedisClient } from "../redis.js";
import { trimHistoryByTokenBudget, validateLLMResponse } from "../utils/guardrails.js";

export class LLMError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = "LLMError";
    this.statusCode = statusCode;
  }
}

export class RateLimitError extends LLMError {
  constructor() {
    super("Rate limited", 429);
    this.name = "RateLimitError";
  }
}

export class ServiceUnavailableError extends LLMError {
  constructor() {
    super("Service unavailable", 503);
    this.name = "ServiceUnavailableError";
  }
}

export class AuthError extends LLMError {
  constructor() {
    super("Auth failed", 500);
    this.name = "AuthError";
  }
}

const openai = new OpenAI({
  apiKey: config.LLM_API_KEY,
  baseURL: config.LLM_BASE_URL,
});

function isFollowUp(message: string): boolean {
  const lower = message.toLowerCase().trim();

  const followUpPatterns = [
    "it", "that", "this", "those", "them",
    "what about", "how about", "and ",
    "really", "ok", "okay", "thanks", "thank you",
  ];

  // Very short messages are likely follow-ups
  if (lower.split(/\s+/).length <= 3) return true;

  // Contains reference words
  if (followUpPatterns.some((p) => lower.includes(p))) return true;

  return false;
}

function buildCacheKey(
  messages: Array<{ role: string; content: string }>,
  userMessage: string,
  followUp: boolean
): string {
  if (followUp) {
    // Full context for follow-ups — includes conversation history
    const hash = crypto.createHash("sha256").update(JSON.stringify(messages)).digest("hex");
    return `llm_cache:ctx:${hash}`;
  }

  // Standalone — cache by message only, ignore history
  const systemPrompt = messages.find((m) => m.role === "system")?.content || "";
  const cachePayload = JSON.stringify([
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ]);
  const hash = crypto.createHash("sha256").update(cachePayload).digest("hex");
  return `llm_cache:msg:${hash}`;
}

const LLM_TIMEOUT_MS = 15000; // 15 seconds backend timeout
const MAX_CONTEXT_TOKENS = 120000; // gpt-4o-mini has 128K, leave headroom

export async function generateReply(
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  try {
    const systemPrompt = buildSystemPrompt();

    // Token budget guard: trim history if approaching context window limit
    const recentHistoryRaw = history.slice(-10);
    const recentHistory = trimHistoryByTokenBudget(
      recentHistoryRaw,
      systemPrompt,
      userMessage,
      config.MAX_TOKENS,
      MAX_CONTEXT_TOKENS
    ) as ChatMessage[];

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...recentHistory.map((m) => ({
        role: m.sender === "user" ? "user" as const : "assistant" as const,
        content: m.text,
      })),
      { role: "user" as const, content: userMessage },
    ];

    const followUp = isFollowUp(userMessage);
    const redis = await getRedisClient();
    const cacheKey = buildCacheKey(messages, userMessage, followUp);

    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(`[CACHE HIT] ${followUp ? "context-aware" : "message-only"} | key=${cacheKey.slice(0, 24)}...`);
        return cached;
      }
    }

    console.log(`[LLM CALL] model=${config.LLM_MODEL} | history=${recentHistory.length} | mode=${followUp ? "follow-up" : "standalone"} | cache=${redis ? "miss" : "disabled"}`);

    // Backend timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const response = await openai.chat.completions.create({
      model: config.LLM_MODEL,
      messages,
      max_tokens: config.MAX_TOKENS,
      temperature: 0.7,
    }, { signal: controller.signal as AbortSignal });

    clearTimeout(timeoutId);

    const choice = response.choices[0];
    if (!choice) {
      throw new LLMError("No response from LLM", 500);
    }

    // Handle content filter refusal gracefully
    if (choice.message.refusal) {
      console.warn(`[LLM REFUSAL] ${choice.message.refusal}`);
      return "I'm sorry, I can't answer that. Please contact the store's support team for assistance.";
    }

    const content = choice.message.content;
    if (!content) {
      throw new LLMError("Empty response from LLM", 500);
    }

    // Validate response before returning
    const validation = validateLLMResponse(content);
    if (!validation.valid) {
      console.error(`[LLM VALIDATION FAILED] reason=${validation.reason}`);
      throw new LLMError("Invalid response from LLM", 500);
    }

    if (redis) {
      await redis.setEx(cacheKey, 3600, content);
      console.log(`[CACHE SET] Response cached for 1 hour (key: ${cacheKey.slice(0, 24)}...)`);
    }

    console.log(`[LLM OK] Response length: ${content.length} chars`);
    return content;
  } catch (error) {
    console.error("LLM error:", error);

    if (error instanceof LLMError) {
      throw error;
    }

    if (error instanceof OpenAI.APIError) {
      const status = error.status;

      if (status === 429) {
        throw new RateLimitError();
      }

      if (status === 401 || status === 403) {
        throw new AuthError();
      }

      if (status >= 500) {
        throw new ServiceUnavailableError();
      }

      throw new LLMError(error.message || "LLM API error", status || 500);
    }

    // Handle backend timeout abort
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[LLM] Request timed out after", LLM_TIMEOUT_MS, "ms");
      throw new ServiceUnavailableError();
    }

    if (
      error instanceof TypeError &&
      (error.message.includes("fetch") ||
        error.message.includes("network") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("ETIMEDOUT"))
    ) {
      throw new ServiceUnavailableError();
    }

    throw new LLMError(
      error instanceof Error ? error.message : "Unknown LLM error",
      500
    );
  }
}
