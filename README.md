# Chat Support Agent

An AI support agent for food-delivery complaints. Customers chat (text, voice or photos) on `/`; a router model decides each step, an LLM agent investigates photo evidence, and a human reviews the resulting case report on `/support`, which also shows a live view of what the backend is doing.

## Stack

- **backend/**: Node 24 + Express 5, TypeScript run directly by Node (no build step)
  - Upstash Redis (REST): chat history, reports, and a job queue with leases, retries and a dead-letter list
  - Postgres (Supabase): customers, reviews and karma, schema in `backend/db/schema.sql`
  - OpenRouter: LLMs, the Jev router and transcription. Sightengine: AI-generated image check
- **frontend/**: React 19 + Vite. Replies and backend activity arrive over Server-Sent Events

## Run locally

```bash
cd backend
cp .env.example .env
npm install
psql "$DATABASE_URL" -f db/schema.sql
npm run dev
```

Fill in `.env` before running the schema. Then, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 for the customer chat and http://localhost:5173/support for the support desk. In development Vite proxies API calls to the backend on port 4000.

## Tests

```bash
cd backend && npm test
```
