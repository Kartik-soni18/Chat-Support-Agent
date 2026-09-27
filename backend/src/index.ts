import express from 'express';
import { z } from 'zod';
import { feed, publishReply, recentActivity, recentReplies, requestContext, step, type Activity, type Reply } from './activity.ts';
import { type CaseReport } from './complaint.ts';
import { handleTurn } from './flow.ts';
import { getCustomer, listCustomers, recordComplaint, reviewComplaint } from './db.ts';
import { karmaScore } from './karma.ts';
import { transcribe } from './llm.ts';
import { appendHistory, getChat, listChats, loadReport, saveReport } from './memory.ts';
import { IMAGES, ORDER } from './order.ts';
import { enqueue, startWorkers, type Job } from './queue.ts';

const env = z.object({ PORT: z.coerce.number().int().default(4000), FRONTEND_URL: z.url().optional() }).parse(process.env);

const ChatBody = z.object({
  chatId: z.uuid(),
  clientId: z.string().min(1),
  text: z.string().trim().default(''),
  imageIds: z.array(z.enum(IMAGES.map((i) => i.id))).max(IMAGES.length).default([]),
})
  .refine((b) => b.text || b.imageIds.length, { message: 'send a message or at least one photo', path: ['text'] })
  .transform((b) => ({ ...b, text: b.text || `Sent ${b.imageIds.length} photo${b.imageIds.length > 1 ? 's' : ''}.` }));

const ReviewBody = z.object({ chatId: z.uuid(), verdict: z.enum(['genuine', 'fake', 'low_confidence']) });

const app = express();
app.use((req, res, next) => {
  if (env.FRONTEND_URL) res.set({ 'Access-Control-Allow-Origin': env.FRONTEND_URL, 'Access-Control-Allow-Headers': 'Content-Type' });
  if (req.method === 'OPTIONS') return void res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId : undefined;
  requestContext.run({ chatId }, () => {
    if (req.method === 'POST') {
      const { images, text, ...fields } = req.body ?? {};
      const detail = { ...fields, ...(text && { text: String(text).slice(0, 80) }), ...(images && { images: images.length }) };
      void step('api', `POST ${req.path}`, detail, () => new Promise<number>((done) => res.on('close', () => done(res.statusCode))), (code) => `HTTP ${code}`);
    }
    next();
  });
});

app.get('/events', (req, res) => {
  const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : undefined;
  const mine = (x: { chatId?: string }) => !chatId || x.chatId === chatId;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (a: Activity) => { if (mine(a)) res.write(`data: ${JSON.stringify(a)}\n\n`); };
  const sendReply = (r: Reply) => { if (mine(r)) res.write(`event: reply\ndata: ${JSON.stringify(r)}\n\n`); };
  recentActivity().forEach(send);
  recentReplies().forEach(sendReply);
  res.write('event: ready\ndata: {}\n\n');
  feed.on('activity', send);
  feed.on('reply', sendReply);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { feed.off('activity', send); feed.off('reply', sendReply); clearInterval(ping); });
});

app.get('/customers', async (_req, res) => {
  try {
    res.json(await listCustomers());
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not load customers' });
  }
});

app.get('/hello', (_req, res) => {
  res.json({ message: 'Hello, world!' });
});

app.post('/chat', async (req, res) => {
  const body = ChatBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: z.treeifyError(body.error) });
  try {
    if (!(await getCustomer(body.data.clientId))) return void res.status(400).json({ error: 'unknown customer' });
    res.status(202).json({ jobId: await enqueue(body.data) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not queue the message' });
  }
});

async function processTurn(job: Job) {
  const turn = ChatBody.parse(job.turn);
  const { chatId, clientId, text, imageIds } = turn;
  const { reply, published } = await handleTurn(turn);
  await Promise.all([
    appendHistory(chatId, { role: 'user', content: text, clientId, ...(imageIds.length && { imageIds }) }, { role: 'assistant', content: reply }),
    published && recordComplaint(clientId),
  ]);
  publishReply({ chatId, jobId: job.id, reply });
}

app.post('/transcribe', express.raw({ type: 'audio/*', limit: '10mb' }), async (req, res) => {
  const format = /^audio\/(webm|mp4|ogg|wav|mpeg)\b/.exec(req.get('content-type') ?? '')?.[1];
  if (!format || !Buffer.isBuffer(req.body) || !req.body.length) {
    return void res.status(400).json({ error: 'send webm, mp4, ogg, wav or mpeg audio as the request body' });
  }
  try {
    res.json({ text: await transcribe(req.body, format === 'mpeg' ? 'mp3' : format) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Transcription failed' });
  }
});

app.get('/order', (_req, res) => {
  res.json({ order: ORDER, images: IMAGES.map(({ id, thumb }) => ({ id, thumb })) });
});

app.post('/review', async (req, res) => {
  const body = ReviewBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: z.treeifyError(body.error) });
  const { chatId, verdict } = body.data;
  try {
    const report = await loadReport<CaseReport>(chatId);
    if (!report) return void res.status(404).json({ error: 'no report for this chat' });
    const before = await getCustomer(report.clientId);
    const after = await reviewComplaint(chatId, report.clientId, verdict);
    const review = { verdict, karmaBefore: karmaScore(before!).score, karmaAfter: karmaScore(after).score };
    await saveReport(chatId, { ...report, review });
    res.json(review);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return void res.status(409).json({ error: 'already reviewed' });
    console.error(err);
    res.status(502).json({ error: 'Review failed' });
  }
});

app.get('/chats', async (_req, res) => {
  try {
    res.json(await listChats());
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not load chats' });
  }
});

app.get('/chats/:chatId', async (req, res) => {
  const chatId = z.uuid().safeParse(req.params.chatId);
  if (!chatId.success) return void res.status(400).json({ error: 'chatId must be a uuid' });
  try {
    const chat = await getChat(chatId.data);
    if (!chat) return void res.status(404).json({ error: 'no such chat (expired?)' });
    res.json(chat);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not load chat' });
  }
});

app.listen(env.PORT, () => console.log(`API on http://localhost:${env.PORT}`));
startWorkers(processTurn, (job, error) => {
  console.error(`queue: job ${job.id} dead after ${job.attempts} attempts: ${error}`);
  if (job.turn?.chatId) publishReply({ chatId: job.turn.chatId, jobId: job.id, error: 'This message could not be processed. Send it again.' });
});
