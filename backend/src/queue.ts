import { requestContext, step } from './activity.ts';
import type { Turn } from './complaint.ts';
import { redis } from './memory.ts';

export const CONCURRENCY = 10;
const LEASE_SECONDS = 180;
const MAX_ATTEMPTS = 3;
const IDLE_POLL_MS = 5 * 60_000;
const REAP_EVERY_MS = 30_000;

const PENDING = 'q:turns';
const PROCESSING = 'q:processing';
const DEAD = 'q:dead';
const lease = (id: string) => `q:lease:${id}`;

export type Job = { id: string; attempts: number; enqueuedAt: number; turn: Turn };
type Handler = (job: Job) => Promise<void>;
type OnDead = (job: Job, error: string) => void;

export async function enqueue(turn: Turn): Promise<string> {
  const job: Job = { id: crypto.randomUUID(), attempts: 0, enqueuedAt: Date.now(), turn };
  await step('queue', `RPUSH ${PENDING}`, { job: job.id.slice(0, 8) },
    () => redis([['RPUSH', PENDING, JSON.stringify(job)]]),
    ([waiting]) => `${waiting} waiting`);
  wakeOne();
  return job.id;
}

const idle: (() => void)[] = [];
const waitForWork = () => new Promise<void>((resolve) => idle.push(resolve));
const wakeOne = () => idle.shift()?.();

async function claim(): Promise<{ job: Job; raw: string } | undefined> {
  const [raw] = (await redis([['LMOVE', PENDING, PROCESSING, 'LEFT', 'RIGHT']])) as [string | null];
  if (!raw) return undefined;
  const job = JSON.parse(raw) as Job;
  await redis([['SET', lease(job.id), '1', 'EX', LEASE_SECONDS]]);
  return { job, raw };
}

const ack = (raw: string, job: Job) => redis([['LREM', PROCESSING, 1, raw], ['DEL', lease(job.id)]]);

async function retry(raw: string, job: Job, error: string, onDead: OnDead) {
  const next = { ...job, attempts: job.attempts + 1 };
  const dead = next.attempts >= MAX_ATTEMPTS;
  await requestContext.run({ chatId: job.turn?.chatId }, () =>
    step('queue', dead ? `→ ${DEAD}` : `retry → ${PENDING}`, { job: job.id.slice(0, 8), attempt: next.attempts, error: error.slice(0, 120) },
      () => redis([['LREM', PROCESSING, 1, raw], ['RPUSH', dead ? DEAD : PENDING, JSON.stringify(next)], ['DEL', lease(job.id)]])));
  if (dead) onDead(next, error);
  else wakeOne();
}

let suspects = new Set<string>();
let inFlight = 0;
let processingSeen = 1;
async function reap(onDead: OnDead) {
  const [raws] = (await redis([['LRANGE', PROCESSING, 0, -1]])) as [string[]];
  processingSeen = raws.length;
  if (!raws.length) { suspects = new Set(); return; }
  const leases = (await redis(raws.map((raw) => ['EXISTS', lease((JSON.parse(raw) as Job).id)]))) as number[];
  const leaseless = raws.filter((_, i) => !leases[i]);
  for (const raw of leaseless.filter((r) => suspects.has(r))) {
    await retry(raw, JSON.parse(raw) as Job, `lease expired after ${LEASE_SECONDS}s (worker crashed or restarted)`, onDead);
  }
  suspects = new Set(leaseless.filter((r) => !suspects.has(r)));
}

const chatTail = new Map<string, Promise<unknown>>();
function oneAtATimePerChat(chatId: string, run: () => Promise<void>): Promise<void> {
  const result = (chatTail.get(chatId) ?? Promise.resolve()).then(run);
  const tail = result.catch(() => {});
  chatTail.set(chatId, tail);
  void tail.then(() => { if (chatTail.get(chatId) === tail) chatTail.delete(chatId); });
  return result;
}

export function startWorkers(handler: Handler, onDead: OnDead) {
  async function worker(n: number) {
    for (;;) {
      let claimed: Awaited<ReturnType<typeof claim>>;
      try {
        claimed = await claim();
      } catch (err) {
        console.error('queue: claim failed', err);
        await new Promise((r) => setTimeout(r, 5_000));
        continue;
      }
      if (!claimed) { await waitForWork(); continue; }
      wakeOne();
      const { job, raw } = claimed;
      inFlight++;
      try {
        await requestContext.run({ chatId: job.turn.chatId }, () =>
          step('queue', 'Worker runs job', { job: job.id.slice(0, 8), worker: n, attempt: job.attempts + 1, waited_ms: Date.now() - job.enqueuedAt },
            () => oneAtATimePerChat(job.turn.chatId, () => handler(job))));
        await ack(raw, job);
      } catch (err) {
        await retry(raw, job, String(err), onDead).catch((e) => console.error('queue: retry failed', e));
      } finally {
        inFlight--;
      }
    }
  }
  for (let n = 1; n <= CONCURRENCY; n++) void worker(n);
  setInterval(wakeOne, IDLE_POLL_MS).unref();
  setInterval(() => {
    if (inFlight || processingSeen) reap(onDead).catch((err) => console.error('queue: reap failed', err));
  }, REAP_EVERY_MS).unref();
}
