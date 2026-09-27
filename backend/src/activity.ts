import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';

export type Kind = 'api' | 'redis' | 'llm' | 'tool' | 'db' | 'jev' | 'queue';
export type Activity = {
  id: string;
  kind: Kind;
  title: string;
  status: 'start' | 'done' | 'error';
  at: number;
  chatId?: string;
  detail?: Record<string, unknown>;
  ms?: number;
  summary?: string;
  result?: unknown;
};

export const requestContext = new AsyncLocalStorage<{ chatId?: string }>();

export const feed = new EventEmitter().setMaxListeners(0);
const recent: Activity[] = [];
const BOOT = Date.now().toString(36);
let seq = 0;

function emit(a: Activity) {
  recent.push(a);
  if (recent.length > 200) recent.shift();
  feed.emit('activity', a);
}
export const recentActivity = () => [...recent];

export type Reply = { chatId: string; jobId: string; reply?: string; error?: string };
const replies: Reply[] = [];
export function publishReply(r: Reply) {
  replies.push(r);
  if (replies.length > 100) replies.shift();
  feed.emit('reply', r);
}
export const recentReplies = () => [...replies];

export async function step<T>(
  kind: Kind,
  title: string,
  detail: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
  summarize?: (result: T) => string,
): Promise<T> {
  const base = { id: `${BOOT}-${++seq}`, kind, title, detail, chatId: requestContext.getStore()?.chatId };
  const started = Date.now();
  emit({ ...base, status: 'start', at: started });
  try {
    const result = await fn();
    emit({
      ...base, status: 'done', at: Date.now(), ms: Date.now() - started, summary: summarize?.(result),
      result: kind === 'tool' || kind === 'jev' ? result : undefined,
    });
    return result;
  } catch (err) {
    emit({ ...base, status: 'error', at: Date.now(), ms: Date.now() - started, summary: String(err).slice(0, 200) });
    throw err;
  }
}
