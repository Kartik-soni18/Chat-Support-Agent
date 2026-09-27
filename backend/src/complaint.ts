import exifr from 'exifr';
import { z } from 'zod';
import { step } from './activity.ts';
import { getCustomer } from './db.ts';
import { karmaScore } from './karma.ts';
import { callModel, complete, imageParts, type Message, type Tool } from './llm.ts';
import { loadHistory, loadReport, saveReport, type StoredMessage } from './memory.ts';
import { IMAGES, ISSUES, ORDER, type IssueId } from './order.ts';

const sightengine = z.object({ API_USER: z.string().min(1), API_SECRET: z.string().min(1) }).parse(process.env);
const UA = 'ChatSupportDemo/1.0';
const MAX_TURNS = 10;

export type Turn = { chatId: string; clientId: string; text: string; imageIds: string[] };
type Image = (typeof IMAGES)[number];

export const orderText = () =>
  `Order ${ORDER.id} from ${ORDER.restaurant}, placed ${ORDER.placedAt}. Items: ` +
  ORDER.items.map((i) => `${i.id}: ${i.qty}× ${i.name} (₹${i.price} for the line)`).join(', ') +
  `. Total ₹${ORDER.items.reduce((sum, i) => sum + i.price, 0)}.`;
export const itemNames = (ids: string[]) => ORDER.items.filter((i) => ids.includes(i.id)).map((i) => i.name).join(', ');

export async function getImageMetadata(img: Image) {
  const res = await fetch(img.url, { headers: { Range: 'bytes=0-131071', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const exif = await exifr.parse(Buffer.from(await res.arrayBuffer()), {
    pick: ['DateTimeOriginal', 'Make', 'Model', 'Software', 'latitude', 'longitude'],
  }).catch(() => undefined);
  if (!exif) return { hasMetadata: false, note: 'No EXIF: typical of screenshots, downloads, messaging apps or AI images.' };
  const takenAt: Date | undefined = exif.DateTimeOriginal;
  return {
    hasMetadata: true,
    takenAt: takenAt?.toISOString(),
    camera: [exif.Make, exif.Model].filter(Boolean).join(' ') || undefined,
    software: exif.Software,
    gps: exif.latitude ? { lat: exif.latitude, lon: exif.longitude } : undefined,
    takenAfterOrder: takenAt ? takenAt >= new Date(ORDER.placedAt) : undefined,
    editedWith: /photoshop|gimp|lightroom|snapseed|picsart|pixelmator|picasa|canva/i.test(exif.Software ?? '') ? exif.Software : undefined,
  };
}

export async function rateSimilarity(img: Image, itemIds: string[]) {
  const text = await complete([{
    role: 'user',
    content: [
      {
        type: 'text',
        text: `You check photos for a food delivery support team.\n${orderText()}\n` +
          (itemIds.length ? `Affected items: ${itemNames(itemIds)}\n\n` : '\n') +
          'Look at the photo. Reply with JSON only: {"similarity": 0-100 confidence that the food shown is the affected ' +
          'items (or, if none are listed, items from this order), "observed": "what food is visible", ' +
          '"supportsComplaint": true|false, "reasoning": "one sentence"}',
      },
      ...imageParts([img.thumb]),
    ],
  }]);
  try {
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text);
  } catch {
    return { raw: text };
  }
}

export async function checkAiGenerated(img: Image) {
  const params = new URLSearchParams({ url: img.thumb, models: 'genai', api_user: sightengine.API_USER, api_secret: sightengine.API_SECRET });
  const data = await (await fetch(`https://api.sightengine.com/1.0/check.json?${params}`)).json();
  if (data.status !== 'success') throw new Error(`Sightengine: ${data.error?.message ?? 'failed'}`);
  return { aiGenerated: data.type.ai_generated };
}

export async function customerKarma(clientId: string) {
  const c = await getCustomer(clientId);
  if (!c) throw new Error(`unknown customer ${clientId}`);
  return { ...c, ...karmaScore(c) };
}

export const SUMMARIES: Record<string, (r: any) => string> = {
  get_image_metadata: (r) => !r.hasMetadata ? 'no EXIF'
    : [r.camera ?? 'unknown camera', r.takenAfterOrder === false && 'before order', r.editedWith && `edited: ${r.editedWith}`].filter(Boolean).join(' · '),
  rate_image_similarity: (r) => (r.raw ? 'unparsed reply' : `${r.similarity}% match · ${r.observed}`),
  check_ai_generated: (r) => `${Math.round(r.aiGenerated * 100)}% likely AI`,
  get_customer_karma: (r) => `karma ${r.score} · ${r.tier}`,
  publish_report: () => 'report ready',
};

const itemIdsArg = { type: 'array', items: { type: 'string', enum: ORDER.items.map((i) => i.id) }, description: 'Affected order items' };
const imageArg = { type: 'object', properties: { image_id: { type: 'string' } }, required: ['image_id'] };
const TOOLS: Tool[] = [
  { type: 'function', function: { name: 'get_image_metadata', description: 'Read EXIF metadata (capture time, camera, editing software, GPS) and check it against the order time.', parameters: imageArg } },
  {
    type: 'function',
    function: {
      name: 'rate_image_similarity',
      description: 'Vision model compares the photo with the order and affected items; returns a 0-100 similarity confidence.',
      parameters: { ...imageArg, properties: { ...imageArg.properties, item_ids: itemIdsArg } },
    },
  },
  { type: 'function', function: { name: 'check_ai_generated', description: 'Sightengine: probability (0-1) that the photo is AI-generated.', parameters: imageArg } },
  { type: 'function', function: { name: 'get_customer_karma', description: "The customer's order history and karma score (0-100, tier trusted/normal/watch) from past complaints and agent verdicts.", parameters: { type: 'object', properties: {} } } },
  {
    type: 'function',
    function: {
      name: 'publish_report',
      description: 'Publish the final case summary to the human support agent. Call exactly once, after all checks.',
      parameters: {
        type: 'object',
        properties: {
          issue: { type: 'string', enum: Object.keys(ISSUES) },
          item_ids: itemIdsArg,
          recommendation: { type: 'string', enum: ['full_refund', 'partial_refund', 'reject', 'needs_human_review'] },
          risk: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Fraud risk' },
          summary: { type: 'string', description: 'What the customer claims and what each check found, per image' },
        },
        required: ['issue', 'recommendation', 'risk', 'summary'],
      },
    },
  },
];
const Report = z.object({
  issue: z.enum(Object.keys(ISSUES) as [IssueId, ...IssueId[]]),
  item_ids: z.array(z.enum(ORDER.items.map((i) => i.id))).default([]),
  recommendation: z.string(),
  risk: z.string(),
  summary: z.string(),
});

export type CaseReport = Omit<z.infer<typeof Report>, 'issue' | 'item_ids'> & {
  issue: string;
  clientId: string;
  customerName: string;
  karma: { score: number; tier: string };
  images: { id: string; thumb: string }[];
  evidence: { tool: string; imageId: string; result: unknown }[];
  review?: { verdict: string; karmaBefore: number; karmaAfter: number };
};

const SYSTEM = `You are a food-delivery support assistant chatting with a customer about this order:
${orderText()}
Issue types (id: label): ${Object.entries(ISSUES).map(([id, i]) => `${id}: ${i.label}${i.needsImages ? ' (needs photos)' : ''}`).join('; ')}.

Work out from the conversation what went wrong and which items are affected. If that is unclear, or the issue needs
photos and none are attached, ask the customer briefly instead of calling tools. If the message is not a complaint,
just answer it.
Once you know enough, investigate: call get_customer_karma, and for EVERY attached photo call get_image_metadata,
rate_image_similarity (with the affected item_ids) and check_ai_generated — all in parallel in one turn. Then call
publish_report once with the issue, item_ids and your recommendation.
Photo evidence decides: AI-generated photos, photos taken before the order, or photos that don't match the order are
strong fraud signals; missing metadata alone is weak. Karma sets how strict to be and breaks ties: give trusted
customers the benefit of the doubt on borderline evidence, scrutinise watch-tier customers — but never reject on low
karma alone. Mention the karma score and tier in the summary.
Always end with a reply to the customer in 1-3 short sentences. Tone: neutral and factual, like a service log. State
what you need or what happens next. No apologies, sympathy, enthusiasm, exclamation marks, emoji, jokes or small talk.
After publishing, only confirm the case is logged and a support agent will follow up. Never tell the customer what the
checks found (photo match, metadata, AI detection), their karma or your recommendation: that is for the support agent.`;

export const stripEmoji = (text: string) => text.replace(/[ \t]*\p{Extended_Pictographic}\uFE0F?/gu, '').trim();

const withPhotos = (text: string, ids?: string[]) => (ids?.length ? `${text}\n\n[Attached photos: ${ids.join(', ')}]` : text);

export async function respond(t: Turn): Promise<{ reply: string; published: boolean }> {
  const [history, existing] = await Promise.all([loadHistory(t.chatId), loadReport(t.chatId)]);
  const attached = [...new Set([...history.flatMap((m) => m.imageIds ?? []), ...t.imageIds])];
  const images = IMAGES.filter((i) => attached.includes(i.id));
  const evidence: { tool: string; imageId: string; result: unknown }[] = [];
  let report: z.infer<typeof Report> | undefined;
  let karma: Awaited<ReturnType<typeof customerKarma>> | undefined;

  async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === 'publish_report') {
      if (existing) return { error: 'A report for this chat was already sent to the support team.' };
      report = Report.parse(args);
      return { ok: true };
    }
    if (name === 'get_customer_karma') return (karma = await customerKarma(t.clientId));
    const img = images.find((i) => i.id === args.image_id);
    if (!img) return { error: `unknown image_id; attached: ${attached.join(', ') || 'none'}` };
    try {
      const result =
        name === 'get_image_metadata' ? await getImageMetadata(img)
        : name === 'rate_image_similarity' ? await rateSimilarity(img, Array.isArray(args.item_ids) ? args.item_ids : [])
        : name === 'check_ai_generated' ? await checkAiGenerated(img)
        : { error: `unknown tool ${name}` };
      evidence.push({ tool: name, imageId: img.id, result });
      return result;
    } catch (err) {
      evidence.push({ tool: name, imageId: img.id, result: { error: String(err) } });
      throw err;
    }
  }
  const tracked = async (name: string, rawArgs: string) => {
    const args = JSON.parse(rawArgs || '{}');
    const detail = name === 'publish_report' ? { issue: args.issue, recommendation: args.recommendation, risk: args.risk } : args;
    return step('tool', name, detail, () => runTool(name, args), SUMMARIES[name]);
  };

  const messages: Message[] = [
    { role: 'system', content: SYSTEM + (existing ? '\nA case report for this chat was already sent to the team: do not investigate again, just help the customer.' : '') },
    ...history.map((m: StoredMessage): Message => ({ role: m.role, content: withPhotos(m.content, m.imageIds) })),
    { role: 'user', content: withPhotos(t.text, t.imageIds) },
  ];
  let reply = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const msg = await callModel(messages, TOOLS);
    messages.push(msg);
    if (!msg.tool_calls?.length) { reply = msg.content ?? ''; break; }
    const results = await Promise.all(msg.tool_calls.map((call) =>
      tracked(call.function.name, call.function.arguments).catch((err) => ({ error: String(err) }))));
    msg.tool_calls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(results[i]) }));
  }
  if (report) {
    karma ??= await customerKarma(t.clientId);
    const { issue, item_ids, ...rest } = report;
    await saveReport(t.chatId, {
      ...rest,
      issue: [ISSUES[issue].label, itemNames(item_ids)].filter(Boolean).join(' · '),
      clientId: t.clientId,
      customerName: karma.name,
      karma: { score: karma.score, tier: karma.tier },
      images: images.map(({ id, thumb }) => ({ id, thumb })),
      evidence,
    } satisfies CaseReport);
  }
  return { reply: stripEmoji(reply) || 'Describe what went wrong with the order.', published: !!report };
}
