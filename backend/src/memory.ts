import { z } from 'zod';
import { step } from './activity.ts';

const env = z.object({
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
}).parse(process.env);

const TTL_SECONDS = 60 * 60;
const MAX_MESSAGES = 40;

export type StoredMessage = { role: 'user' | 'assistant'; content: string; imageIds?: string[]; at?: number; clientId?: string };

const key = (chatId: string) => `chat:${chatId}`;
const short = (k: string) => k.slice(0, k.indexOf(':') + 9) + '…';

export async function redis(commands: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(`${env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  const replies = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = replies.find((r) => r.error);
  if (failed) throw new Error(`Redis: ${failed.error}`);
  return replies.map((r) => r.result);
}

export async function loadHistory(chatId: string): Promise<StoredMessage[]> {
  const [items] = await step('redis', `LRANGE ${short(key(chatId))}`, { range: 'all' },
    () => redis([['LRANGE', key(chatId), 0, -1]]),
    ([items]) => `${(items as string[]).length} messages`);
  return (items as string[]).map((s) => JSON.parse(s));
}

export async function appendHistory(chatId: string, ...messages: StoredMessage[]): Promise<void> {
  const k = key(chatId);
  await step('redis', `RPUSH ${short(k)}`,
    { added: messages.length, roles: messages.map((m) => m.role).join(' + '), cap: MAX_MESSAGES, ttl: '1h (sliding)', pipeline: 'RPUSH · LTRIM · EXPIRE' },
    () => redis([
      ['RPUSH', k, ...messages.map((m) => JSON.stringify({ ...m, at: m.at ?? Date.now() }))],
      ['LTRIM', k, -MAX_MESSAGES, -1],
      ['EXPIRE', k, TTL_SECONDS],
    ]),
    ([length]) => `list now ${length} messages`);
}

export type ChatSummary = { chatId: string; clientId?: string; startedAt?: number; messages: StoredMessage[]; report?: unknown };

export async function saveReport(chatId: string, report: object): Promise<void> {
  const json = JSON.stringify(report);
  await step('redis', `SET ${short(`report:${chatId}`)}`, { bytes: json.length, ttl: '1h', fields: Object.keys(report).join(', ') },
    () => redis([['SET', `report:${chatId}`, json, 'EX', TTL_SECONDS]]));
}

export async function saveMemory(chatId: string, memory: string): Promise<void> {
  await step('redis', `SET ${short(`mem:${chatId}`)}`, { words: memory.split(/\s+/).length, ttl: '1h' },
    () => redis([['SET', `mem:${chatId}`, memory, 'EX', TTL_SECONDS]]));
}

export async function loadMemory(chatId: string): Promise<string | undefined> {
  const [memory] = await step('redis', `GET ${short(`mem:${chatId}`)}`, undefined,
    () => redis([['GET', `mem:${chatId}`]]),
    ([m]) => (m ? `"${String(m).slice(0, 60)}"` : 'none yet'));
  return (memory as string | null) ?? undefined;
}

export async function loadReport<T>(chatId: string): Promise<T | undefined> {
  const [json] = await step('redis', `GET ${short(`report:${chatId}`)}`, undefined,
    () => redis([['GET', `report:${chatId}`]]),
    ([json]) => (json ? 'found' : 'missing'));
  return json ? JSON.parse(json as string) : undefined;
}

function toSummary(chatId: string, items: string[], report: string | null): ChatSummary {
  const messages = items.map((s) => JSON.parse(s) as StoredMessage);
  return { chatId, clientId: messages.find((m) => m.clientId)?.clientId, startedAt: messages[0]?.at, messages, report: report ? JSON.parse(report) : undefined };
}

export async function getChat(chatId: string): Promise<ChatSummary | undefined> {
  const [items, report] = (await redis([['LRANGE', key(chatId), 0, -1], ['GET', `report:${chatId}`]])) as [string[], string | null];
  return items.length ? toSummary(chatId, items, report) : undefined;
}

export async function listChats(): Promise<ChatSummary[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [[next, page]] = (await redis([['SCAN', cursor, 'MATCH', 'chat:*', 'COUNT', 100]])) as [string, string[]][];
    cursor = next;
    keys.push(...page);
  } while (cursor !== '0');
  if (!keys.length) return [];

  const ids = keys.map((k) => k.slice('chat:'.length));
  const replies = await redis(ids.flatMap((id) => [['LRANGE', key(id), 0, -1], ['GET', `report:${id}`]]));
  return ids
    .map((chatId, i) => toSummary(chatId, ...(replies.slice(i * 2, i * 2 + 2) as [string[], string | null])))
    .sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));
}
