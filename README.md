# Chat Support Agent

A mini AI customer support chat widget. The app demonstrates contextual answers from an OpenAI-compatible model and conversation persistence in SQLite.

---

## Features

- **Real-time AI chat** — Messages are sent to a backend that calls OpenAI's GPT-4o-mini with a tailored support agent prompt
- **Contextual conversations** — The AI remembers up to 10 previous messages for contextually relevant replies
- **Session persistence** — Conversations are saved to SQLite and can be resumed via session ID (stored in localStorage)
- **FAQ domain knowledge** — The AI is seeded with policies for a fictional Demo Store, including shipping, returns, support hours, and payment info
- **Smart caching** — Redis-backed response cache reduces LLM costs and latency for repeated questions
- **Input guardrails** — Sanitization, prompt injection detection, token budget guards, and backend timeouts prevent bad input from breaking the system
- **Robust error handling** — Graceful handling of LLM failures, rate limits, network errors, content filter refusals, and invalid input with user-friendly messages
- **Clean, responsive UI** — Works on desktop and mobile with auto-scroll, typing indicators, and optimistic message updates

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20 + TypeScript + Express 4 |
| Database | SQLite 3 via `better-sqlite3` (WAL mode) |
| Cache | Redis (optional, with graceful fallback) |
| LLM | OpenAI GPT-4o-mini or Together AI (e.g. `meta-llama/Llama-3.3-70B-Instruct-Turbo`, configurable via `OPENAI_BASE_URL`) |
| Validation | Zod (backend & frontend) |
| Frontend | SvelteKit 2 + Svelte 5 + TypeScript |
| Styling | Tailwind CSS 3 |

---

## How to Run Locally

### Prerequisites

- [Node.js](https://nodejs.org/) 20+ (LTS recommended)
- An [OpenAI API key](https://platform.openai.com/api-keys) (or Together AI key)

### 1. Clone & Install

```bash
git clone <repo-url> chat-support-agent
cd chat-support-agent

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure Environment Variables

```bash
# In the backend folder
cd backend
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```env
PORT=3001
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini
# OPENAI_BASE_URL=https://api.openai.com/v1  # Optional
MAX_TOKENS=500
DB_PATH=./chat.db
NODE_ENV=development
```

For the frontend, create a `.env` file:

```bash
cd ../frontend
```

```env
VITE_API_URL=http://localhost:3001
```

> **Note**: Never commit `.env` files to git. They are already in `.gitignore`.

### 3. Set Up the Database

The database is created automatically when the server starts — no manual migration needed.

Optionally, seed the database with a sample conversation:

```bash
cd backend
npm run seed
```

### 4. Start the Backend

```bash
cd backend
npm run dev
```

The API server will start on `http://localhost:3001`.

### 5. Start the Frontend (new terminal)

```bash
cd frontend
npm run dev
```

The frontend will start on `http://localhost:5173`.

### 6. Open the App

Navigate to `http://localhost:5173` and start chatting!

---


---

## Architecture Overview

### Backend Design

The backend follows a **layered architecture** with clear separation of concerns:

1. **Routes layer** (`routes/chat.ts`) — HTTP concerns only: parsing, Zod validation, calling services, returning JSON. Zero business logic.

2. **Services layer** (`services/`) — All business logic:
   - `llm.ts` — Encapsulates the LLM integration behind a clean `generateReply(history, userMessage)` interface. Swapping providers (Claude, Groq, etc.) requires changing one file.
   - `conversation.ts` — All DB operations using prepared statements. Route handlers never touch SQL directly.
   - `faq.ts` — FAQ knowledge and prompt engineering. Updating store policies means editing one file.

3. **Utils layer** (`utils/guardrails.ts`) — Input sanitization, token estimation, prompt injection detection, and response validation. Keeps security concerns separate from business logic.

4. **Middleware layer** (`middleware/errorHandler.ts`) — Centralized error handling. Maps internal errors to HTTP status codes and user-friendly messages. Auth errors are masked (500) so they don't leak to users.

### Data Flow

```
User types message
    → Frontend POST /api/chat/message { message, sessionId }
    → Backend validates with Zod + sanitizes input
    → Detect prompt injection (log only, don't block)
    → Persist user message to SQLite
    → Check Redis cache (message-only key for standalone, context key for follow-ups)
    → Cache miss: build OpenAI prompt (system + trimmed history + user message)
    → Call OpenAI API with 15s backend timeout
    → Handle refusal / empty / invalid responses
    → Persist AI reply to SQLite
    → Cache response in Redis (1h TTL)
    → Return { reply, sessionId }
    → Frontend displays reply
```

---

## Caching Strategy

The backend uses a **two-tier caching** approach with Redis:

### Cache Key Design

- **Standalone questions** (first message or non-follow-up): `llm_cache:msg:<hash>`
  - Hash includes system prompt + user message only
  - Ignores conversation history
  - Maximizes cache hits for common FAQs like "What's your return policy?"

- **Follow-up questions**: `llm_cache:ctx:<hash>`
  - Hash includes full conversation context (system + history + message)
  - Needed because follow-ups depend on prior context

### Follow-Up Detection Heuristic

A message is classified as a follow-up if:
- It's very short (≤3 words), OR
- It contains reference words: "it", "that", "this", "what about", "how about", "and", "ok", "thanks"

This is a simple heuristic that works well for support chat. With more data, I'd train a lightweight classifier.

### TTL & Invalidation

- **TTL**: 1 hour (`3600` seconds)
- **Invalidation strategy**: None needed. FAQ responses are stable. For dynamic content (order status, inventory), I'd use cache-busting or shorter TTLs.

### Fallback

If Redis is unavailable, the app continues without caching. No user-facing degradation.

### Cost Impact

At OpenAI's pricing, a typical conversation costs ~$0.005. With caching, repeated questions cost $0. For a support bot handling hundreds of similar questions daily, this cuts LLM costs by 30–60%.

---

## Guardrails & Prompt Safety

### Input Sanitization

Before any message touches the database or LLM:
- **Control character stripping** — Removes null bytes (`\x00`), escape sequences, and other control chars that could break JSON/SQLite
- **Whitespace normalization** — Collapses multiple spaces/tabs, caps consecutive newlines at 2

### Prompt Injection Detection

Common injection patterns are detected and logged (not blocked, to avoid false positives):
- `"ignore all previous instructions"`
- `"you are now a [role]"`
- `"jailbreak"` / `"DAN"`
- `"system override"`

The chat completions API format (separate `system`/`user`/`assistant` roles) already makes injection harder than raw string concatenation. Logging lets operators monitor attack attempts without censoring legitimate questions.

### Token Budget Guard

A rough estimator (`~4 chars/token`) ensures the full prompt (system + history + user message + max response tokens) never exceeds the model's context window. If it does, the oldest history messages are trimmed until it fits.

### Backend Timeout

LLM calls abort after **15 seconds** via `AbortController`. Prevents hung requests from tying up the event loop.

### LLM Response Hardening

- **Refusal handling** — If OpenAI's content filter triggers (`message.refusal`), returns a graceful fallback instead of crashing
- **Response validation** — Ensures the response is non-empty and under 10,000 characters
- **Error categorization** — 429 (rate limit), 401/403 (auth, masked as 500), 5xx (service unavailable), network errors → all mapped to user-friendly messages

---

## LLM Integration Notes

### Provider
**OpenAI GPT-4o-mini** — chosen for its excellent cost-to-performance ratio. The backend also supports Together AI (set `TOGETHER_API_KEY` + `TOGETHER_MODEL` instead of OpenAI vars).

### Prompt Design

The system prompt includes:
- Role definition ("helpful, friendly customer support agent for Demo Store")
- Structured FAQ knowledge (shipping, returns, support hours, payment)
- Constraint to be honest when it doesn't know something
- Max length hint ("keep responses under 150 words")

Conversation history is included as context — the last 10 messages are sent with each request. Token budget guards automatically trim this if needed.

### Error Handling

| OpenAI Error | HTTP Status | User Message |
|-------------|-------------|--------------|
| Rate limit (429) | 429 | "We're experiencing high demand. Please try again in a moment." |
| Auth failure (401) | 500 (masked) | "Something went wrong on our end." |
| Content filter refusal | 200 (graceful fallback) | "I'm sorry, I can't answer that..." |
| Network timeout | 503 | "Our AI assistant is temporarily unavailable." |
| Other API errors | 500 | "Something went wrong on our end. Please try again." |

### Cost Controls

- **Model**: `gpt-4o-mini`
- **Max tokens**: 500 per response
- **Context window**: Last 10 messages (auto-trimmed if token budget exceeded)
- **Max message length**: 2000 characters
- **Caching**: Redis with 1h TTL

At OpenAI's current pricing, a typical uncached conversation costs less than $0.01. Cached conversations cost $0.

---

## API Reference

### `POST /api/chat/message`

Send a message and get an AI reply.

**Body:**
```json
{
  "message": "What's your return policy?",
  "sessionId": "optional-existing-uuid"
}
```

**Response (200):**
```json
{
  "reply": "You can return any item within 30 days...",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### `GET /api/chat/history/:sessionId`

Fetch conversation history.

**Response (200):**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "messages": [
    { "id": 1, "sender": "user", "text": "...", "timestamp": "2026-06-03T10:00:00.000Z" },
    { "id": 2, "sender": "ai", "text": "...", "timestamp": "2026-06-03T10:00:02.000Z" }
  ]
}
```

### `GET /health`

Health check. Returns `{ "status": "ok" }`.



---

## Deployment Notes

### Render (Free Tier)

This project includes a `render.yaml` Blueprint for easy deployment on [Render](https://render.com).

The Blueprint names the services `chat-support-agent-frontend` and `chat-support-agent-backend`. Set `FRONTEND_URL` to the frontend's actual deployed URL and `VITE_API_URL` to the backend's actual deployed URL when creating the services.

> ⚠️ **Non-Persistent Storage (Free Tier Limitation)**
>
> The backend uses **SQLite** for simplicity. On Render's free tier, the filesystem is **ephemeral** — this means:
> - All chat conversations are **lost on every redeploy or service restart**
> - Render free instances spin down after ~15 minutes of inactivity; when they wake up, the database is empty
> - The `sessionId` stored in your browser's `localStorage` will refer to a conversation that no longer exists on the backend, causing errors until you clear the chat or use incognito mode
>
> **This is expected behavior for a free-tier MVP/demo.** For production, you should either:
> - Add a **persistent disk** to the backend service (requires a paid instance), or
> - Switch to **[Render Postgres](https://render.com/docs/databases)** (free tier available)

### Environment Variables

After the initial Blueprint deploy, manually set these in the Render Dashboard for the backend service:
- `OPENAI_API_KEY` — your API key (OpenAI or Together AI)
- `OPENAI_BASE_URL` — e.g. `https://api.together.xyz/v1` for Together AI
- `REDIS_URL` — optional, for Redis caching (e.g. Upstash)

---

## Trade-offs & "If I Had More Time..."

### What's intentionally simple

1. **SQLite instead of PostgreSQL** 

3. **No WebSocket / real-time push** — The frontend polls via HTTP requests. For a real product, I'd use Server-Sent Events (SSE) or WebSockets for streaming LLM responses word-by-word.

**Caching layer** — I implemented Redis-backed LLM response caching with message-only keys for standalone questions and context-aware keys for follow-ups. This is the right architecture, but with more data I'd:
- Add a **cache hit ratio dashboard** to tune the follow-up heuristic
- Implement **semantic caching** (embed questions, cache by vector similarity) instead of exact-match hashing
- Add **cache warming** for the top 20 most common questions

**Input guardrails** — I built sanitization, injection detection, token budgets, and response validation. With more context about the actual threat model and FAQ domain, I'd:
- Replace the heuristic follow-up detector with a **trained classifier**
- Add **OpenAI Moderation API** checks for toxic/harmful content
- Implement **PII redaction** before messages hit the LLM
- Add **rate limiting per conversation** (not just per IP) to prevent abuse

### What I'd add with more time

1. **Streaming responses** — Show the AI response being typed out in real-time using OpenAI's streaming API with SSE.

2. **Multi-channel support** — The architecture (service layer, conversation model) is designed to make it easy to add WhatsApp, Instagram DM, and Facebook Messenger channels.

3. **Tool use / function calling** — Give the AI access to tools like "check order status" or "initiate return" by calling actual functions.

---
