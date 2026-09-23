import { Router } from "express";
import { z } from "zod";
import {
  createConversation,
  getMessages,
  getMessagesBeforeMessage,
  getMessageByClientMessageId,
  getReplyAfterMessage,
  addMessage,
  conversationExists,
} from "../services/conversation.js";
import { generateReply } from "../services/llm.js";
import { getRedisClient } from "../redis.js";
import { sanitizeUserInput, detectPromptInjection } from "../utils/guardrails.js";
import type { Request, Response, NextFunction } from "express";

const RATE_LIMIT_MAX = 20; // requests per window
const RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute

async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const clientIp = req.ip || "unknown";
  const key = `rate_limit:${clientIp}`;

  const redis = await getRedisClient();
  if (!redis) {
    next();
    return;
  }

  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }

    console.log(`[RATE LIMIT] IP=${clientIp} | count=${current}/${RATE_LIMIT_MAX} | window=${RATE_LIMIT_WINDOW_SECONDS}s`);

    if (current > RATE_LIMIT_MAX) {
      console.log(`[RATE LIMIT] BLOCKED IP=${clientIp}`);
      res.status(429).json({
        error: "Too many messages. Please slow down and try again in a moment.",
      });
      return;
    }

    next();
  } catch {
    // If Redis fails, allow the request through rather than blocking users
    next();
  }
}

const router = Router();

const sendMessageSchema = z.object({
  message: z
    .string()
    .min(1, "Message is required")
    .max(2000, "Message too long")
    .transform((s) => s.trim()),
  sessionId: z.string().uuid().optional().nullable(),
  clientMessageId: z.string().uuid(),
});

const sessionIdSchema = z.string().uuid();

router.post(
  "/message",
  rateLimitMiddleware,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = sendMessageSchema.safeParse(req.body);

      if (!parseResult.success) {
        const issue = parseResult.error.issues[0];
        const message = issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid request";
        const error = new Error(message);
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }

      let { message } = parseResult.data;
      const { sessionId, clientMessageId } = parseResult.data;

      // Sanitize input: strip control chars, normalize whitespace
      message = sanitizeUserInput(message);

      if (!message || message.length === 0) {
        const error = new Error("Message is required and must be between 1 and 2000 characters");
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }

      // Log prompt injection attempts (don't block, but monitor)
      if (detectPromptInjection(message)) {
        console.warn(`[GUARDRAIL] Prompt injection detected | sessionId=${sessionId || "new"} | msg=${message.slice(0, 100)}...`);
      }

      console.log(`[REQUEST] msgLen=${message.length} | existingSession=${sessionId ? "yes" : "no"}`);

      let conversationId: string;

      if (sessionId) {
        if (!conversationExists(sessionId)) {
          const error = new Error("Conversation not found");
          (error as Error & { statusCode: number }).statusCode = 404;
          throw error;
        }
        conversationId = sessionId;
      } else {
        conversationId = createConversation();
      }

      const existingMessage = getMessageByClientMessageId(conversationId, clientMessageId);
      if (existingMessage) {
        const existingReply = getReplyAfterMessage(conversationId, existingMessage.id);
        if (existingReply) {
          console.log(`[IDEMPOTENT REPLY] sessionId=${conversationId} | clientMessageId=${clientMessageId}`);
          res.json({ reply: existingReply.text, sessionId: conversationId });
          return;
        }

        // A prior request saved the user message but failed before producing a reply.
        // Use only the earlier turns as context so this message is not sent twice.
        const history = getMessagesBeforeMessage(conversationId, existingMessage.id);
        const reply = await generateReply(history, message);
        addMessage(conversationId, "ai", reply);

        console.log(`[RETRIED REPLY] sessionId=${conversationId} | replyLen=${reply.length}`);
        res.json({ reply, sessionId: conversationId });
        return;
      }

      // Capture context before writing the new user turn. generateReply appends
      // userMessage itself, so loading history afterwards would duplicate it.
      const history = getMessages(conversationId);
      addMessage(conversationId, "user", message, clientMessageId);

      const reply = await generateReply(history, message);

      addMessage(conversationId, "ai", reply);

      console.log(`[RESPONSE] sessionId=${conversationId} | replyLen=${reply.length}`);
      res.json({ reply, sessionId: conversationId });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/history/:sessionId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = sessionIdSchema.safeParse(req.params.sessionId);

      if (!parseResult.success) {
        const error = new Error("Invalid sessionId format");
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }

      const sessionId = parseResult.data;

      if (!conversationExists(sessionId)) {
        const error = new Error("Conversation not found");
        (error as Error & { statusCode: number }).statusCode = 404;
        throw error;
      }

      const messages = getMessages(sessionId);

      console.log(`[HISTORY] Returned ${messages.length} messages | sessionId=${sessionId}`);
      res.json({ sessionId, messages });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
