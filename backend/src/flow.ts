import { z } from 'zod';
import { step } from './activity.ts';
import {
  checkAiGenerated, customerKarma, getImageMetadata, itemNames, orderText, rateSimilarity, respond, stripEmoji, SUMMARIES,
  type CaseReport, type Turn,
} from './complaint.ts';
import { complete } from './llm.ts';
import { loadHistory, loadMemory, loadReport, saveMemory, saveReport } from './memory.ts';
import { IMAGES, ISSUES, ORDER, type IssueId } from './order.ts';
import { evidenceQuestions, nextStepQuestions, reply, route, verdict, type Answers, type Decision, type Question } from './route.ts';

const { OPENROUTER_API_KEY } = z.object({ OPENROUTER_API_KEY: z.string().min(1) }).parse(process.env);
const JEV_MODEL = 'typesafe/jev-1.13';
const JEV_TIMEOUT_MS = 8000;
const CHECK_TIMEOUT_MS = 20_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const describeAnswers = (a: Answers) =>
  Object.entries(a).map(([k, v]) =>
    v.type === 'choice' ? `${k}=${v.choice} ${(v.confidence ?? 0).toFixed(2)}`
    : v.type === 'score' ? `${k}=${v.score.toFixed(2)}`
    : v.noul >= 0.5 ? `${k.replace(/^item_/, '')} ${v.noul.toFixed(2)}` : '',
  ).filter(Boolean).join(' · ');

function jev(title: string, state: object, questions: Record<string, Question>): Promise<Answers> {
  return step('jev', title, { model: JEV_MODEL, questions: Object.keys(questions).join(', ') }, async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch('https://openrouter.ai/api/alpha/decisions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: JEV_MODEL, state, questions }),
          signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
        });
        if (!res.ok) throw Object.assign(new Error(`Jev ${res.status}: ${await res.text()}`), { retry: res.status >= 500 });
        return ((await res.json()) as { answers: Answers }).answers;
      } catch (err) {
        if (attempt === 2 || (err as { retry?: boolean }).retry === false) throw err;
      }
    }
  }, describeAnswers);
}

const Written = z.object({ memory: z.string().min(1), draft: z.string().default('') });
const WRITER = `You keep notes for a food-delivery support system and draft replies. ${orderText()}
You get the previous memory and the customer's latest message. Reply with JSON only:
{"memory": "...", "draft": "..."}
memory: at most 60 words in English, facts only: what the customer reports, which items, which photos are attached, what
support already asked. Keep earlier facts that still matter. Don't judge the evidence or say whether a report was sent:
the system tracks that and runs the checks at the same time as you.
draft: 1-3 short sentences answering the latest message, in the customer's language and script. Neutral and factual: no
apologies, sympathy, exclamation marks or emoji. Only state facts from the order above; for anything else (policies,
addresses, timings, refunds) say a support agent will confirm. Never mention fraud checks, scores or evidence.`;

async function writer(memory: string, text: string, photos: string[], reportSent: boolean) {
  const out = await complete([
    { role: 'system', content: WRITER },
    { role: 'user', content: JSON.stringify({ previous_memory: memory, latest_message: text, photos_attached: photos, report_sent: reportSent }) },
  ]);
  return Written.parse(JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] ?? out));
}

const translate = (text: string, customerMessage: string) =>
  complete([{
    role: 'user',
    content: `Customer message: ${JSON.stringify(customerMessage)}\nTranslate this support reply into the same language and ` +
      `script as the customer message. Keep it neutral. Reply with the translation only.\n\n${text}`,
  }]);

async function investigate(t: Turn, issue: IssueId, itemIds: string[], photoIds: string[], memory: string) {
  const images = IMAGES.filter((i) => photoIds.includes(i.id));
  const evidence: CaseReport['evidence'] = [];
  const check = (name: string, img: (typeof images)[number], detail: object, fn: () => Promise<unknown>) =>
    step('tool', name, { image_id: img.id, ...detail }, () => withTimeout(fn(), CHECK_TIMEOUT_MS), SUMMARIES[name])
      .catch((err) => ({ error: String(err) }))
      .then((result) => { evidence.push({ tool: name, imageId: img.id, result }); });

  const [karma] = await Promise.all([
    step('tool', 'get_customer_karma', { client_id: t.clientId }, () => customerKarma(t.clientId), SUMMARIES.get_customer_karma),
    ...images.flatMap((img) => [
      check('get_image_metadata', img, {}, () => getImageMetadata(img)),
      check('rate_image_similarity', img, { item_ids: itemIds.join(', ') || 'whole order' }, () => rateSimilarity(img, itemIds)),
      check('check_ai_generated', img, {}, () => checkAiGenerated(img)),
    ]),
  ]);

  const answers = await jev('Jev · recommendation', {
    complaint: memory,
    issue: ISSUES[issue].label,
    affected_items: itemNames(itemIds) || 'not specified',
    karma: { score: karma.score, tier: karma.tier, total_orders: karma.totalOrders, problem_orders: karma.problemOrders, flagged_reports: karma.flaggedReports },
    photo_checks: evidence.length ? evidence : 'no photos attached',
  }, evidenceQuestions).catch(() => undefined);
  const v = verdict(answers);

  await step('tool', 'publish_report', { recommendation: v.recommendation, risk: v.risk }, () => saveReport(t.chatId, {
    recommendation: v.recommendation,
    risk: v.risk,
    summary: `${memory}\nJev: ${v.recommendation.replaceAll('_', ' ')} (confidence ${v.confidence.toFixed(2)}), risk ${v.risk}. ` +
      `Karma ${karma.score} (${karma.tier}).`,
    issue: [ISSUES[issue].label, itemNames(itemIds)].filter(Boolean).join(' · '),
    clientId: t.clientId,
    customerName: karma.name,
    karma: { score: karma.score, tier: karma.tier },
    images: images.map(({ id, thumb }) => ({ id, thumb })),
    evidence,
  } satisfies CaseReport), () => 'report ready');
}

const pendingMemory = new Map<string, Promise<unknown>>();

const needsTranslation = (text: string) => /[^\P{L}\p{Script=Latin}]/u.test(text);

export async function handleTurn(t: Turn): Promise<{ reply: string; published: boolean }> {
  await pendingMemory.get(t.chatId);
  const [history, report, memory = 'New conversation.'] = await Promise.all([loadHistory(t.chatId), loadReport(t.chatId), loadMemory(t.chatId)]);
  const photos = [...new Set([...history.flatMap((m) => m.imageIds ?? []), ...t.imageIds])];
  const reportSent = !!report;

  const written = writer(memory, t.text, photos, reportSent);
  const saving = written.then((w) => saveMemory(t.chatId, w.memory)).catch((err) => console.error('memory not saved:', err));
  pendingMemory.set(t.chatId, saving);
  void saving.finally(() => { if (pendingMemory.get(t.chatId) === saving) pendingMemory.delete(t.chatId); });

  let d: Decision = await jev('Jev · next step', { order: orderText(), memory, photos_attached: photos, report_sent: reportSent, latest_message: t.text }, nextStepQuestions)
    .then((answers) => route(answers, { reportSent, photos: photos.length }))
    .catch((err): Decision => ({ action: 'fallback', items: [], confidence: 0, reason: `Jev unavailable: ${String(err).slice(0, 120)}` }));

  const w = d.action === 'answer_question' || d.action === 'investigate' ? await written.catch(() => undefined) : undefined;
  if (d.action === 'answer_question' && !w?.draft) d = { ...d, action: 'fallback', reason: 'no draft from the writer' };

  if (d.action === 'fallback') {
    const reason = d.reason;
    return step('llm', 'Fallback → LLM agent', { reason }, () => respond(t), (r) => (r.published ? 'report published' : 'replied'));
  }

  let text: string;
  if (d.action === 'answer_question') text = w!.draft;
  else {
    if (d.action === 'investigate') await investigate(t, d.issue!, d.items, photos, w?.memory ?? `${memory}\nLatest: ${t.text}`);
    text = reply(d.action, { items: itemNames(d.items), reportSent: reportSent || d.action === 'investigate' });
    if (needsTranslation(t.text)) text = await translate(text, t.text).catch(() => text);
  }
  return { reply: stripEmoji(text), published: d.action === 'investigate' };
}
