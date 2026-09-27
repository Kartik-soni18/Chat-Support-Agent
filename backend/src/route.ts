import { ISSUES, ORDER, type IssueId } from './order.ts';

export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria: { true: string; false: string } };
export type Answer =
  | { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; confidence?: number; probabilities?: Record<string, number> }
  | { type: 'noul'; noul: number };
export type Answers = Record<string, Answer>;

export const MIN_CONFIDENCE: Record<string, number> = { investigate: 0.7, recommendation: 0.6, default: 0.5 };
export const ITEM_THRESHOLD = 0.5;

const NEXT = {
  ask_what_happened: 'The customer has a problem but has not said what went wrong.',
  ask_which_items: 'The customer reports missing, wrong or bad food but has not said which items.',
  ask_for_photo: 'The complaint is about missing, wrong or bad food, the items are known, and no photo is attached yet.',
  investigate: 'The complaint is clear enough to check: issue and items are known and a photo is attached, or the food was never delivered.',
  answer_question: 'The customer asks a question about the order that needs a written answer, not a complaint.',
  case_already_logged: 'A report was already sent to the support team and the customer adds nothing new.',
  chit_chat: 'Greeting, thanks or acknowledgement, with nothing to act on.',
  off_topic: 'The message is unrelated to this food order.',
  other: 'None of the above fits.',
};
const ISSUE_CRITERIA: Record<IssueId, string> = {
  not_delivered: 'The food never arrived.',
  quality: 'Food spoiled, cold, bad taste, or a foreign object such as hair or plastic.',
  missing: 'Some items from the order were missing.',
  wrong_order: 'Received different food than ordered.',
};
export type Step = keyof typeof NEXT;
const AFTER_REPORT: Step[] = ['investigate', 'case_already_logged', 'chit_chat'];
export type Action = Exclude<Step, 'other'> | 'fallback';

export const itemKey = (id: string) => `item_${id.replaceAll('-', '_')}`;

export const nextStepQuestions: Record<string, Question> = {
  next: { type: 'choice', instructions: "Decide the support system's next step for this conversation, based on the memory and the customer's latest message.", criteria: NEXT },
  issue: { type: 'choice', instructions: 'If the customer reports a problem, which issue type fits best?', criteria: { ...ISSUE_CRITERIA, unclear: 'Not a complaint, or too vague to classify.' } },
  ...Object.fromEntries(ORDER.items.map((i): [string, Question] => [itemKey(i.id), {
    type: 'noul',
    instructions: `Does the conversation say ${i.name} was affected by the problem?`,
    criteria: { true: `${i.name} is named or clearly referred to as affected.`, false: `${i.name} is not mentioned as affected.` },
  }])),
};

export type Context = { reportSent: boolean; photos: number };
export type Decision = { action: Action; issue?: IssueId; items: string[]; confidence: number; reason?: string };

export function route(a: Answers, ctx: Context): Decision {
  const next = a.next;
  if (next?.type !== 'choice') return { action: 'fallback', items: [], confidence: 0, reason: 'no next-step answer' };
  const confidence = next.confidence ?? 0;
  const issueAnswer = a.issue;
  const issue = issueAnswer?.type === 'choice' && issueAnswer.choice in ISSUES ? (issueAnswer.choice as IssueId) : undefined;
  const items = issue === 'not_delivered' ? [] : ORDER.items
    .filter((i) => { const n = a[itemKey(i.id)]; return n?.type === 'noul' && n.noul >= ITEM_THRESHOLD; })
    .map((i) => i.id);
  const base = { issue, items, confidence };
  const step = next.choice as Step;

  if (!(step in NEXT) || step === 'other') return { ...base, action: 'fallback', reason: `Jev chose ${next.choice}` };
  if (ctx.reportSent && AFTER_REPORT.includes(step)) {
    const p = next.probabilities ? AFTER_REPORT.reduce((sum, s) => sum + (next.probabilities![s] ?? 0), 0) : confidence;
    return p >= MIN_CONFIDENCE.default
      ? { ...base, confidence: p, action: step === 'chit_chat' ? 'chit_chat' : 'case_already_logged' }
      : { ...base, action: 'fallback', reason: `after-report steps at ${p.toFixed(2)} are below the bar` };
  }
  if (confidence < (MIN_CONFIDENCE[step] ?? MIN_CONFIDENCE.default)) {
    return { ...base, action: 'fallback', reason: `${step} at ${confidence.toFixed(2)} is below the bar` };
  }
  if (step !== 'investigate') return { ...base, action: step };
  if (!issue) return { ...base, action: 'fallback', reason: 'investigate without a clear issue' };
  if (ISSUES[issue].needsItems && !items.length) return { ...base, action: 'ask_which_items' };
  if (ISSUES[issue].needsImages && !ctx.photos) return { ...base, action: 'ask_for_photo' };
  return { ...base, action: 'investigate' };
}

export function reply(action: Exclude<Action, 'fallback' | 'answer_question'>, ctx: { items: string; reportSent: boolean }): string {
  switch (action) {
    case 'ask_what_happened': return 'What went wrong with the order?';
    case 'ask_which_items': return 'Which items were affected?';
    case 'ask_for_photo': return `Attach a photo of the ${ctx.items || 'food that was delivered'} with the attach button, then send it.`;
    case 'investigate': return 'The case is logged. A support agent will follow up.';
    case 'case_already_logged': return 'The case is already with the support team. A support agent will follow up.';
    case 'chit_chat': return ctx.reportSent ? 'Noted. A support agent will follow up.' : 'Noted. Describe the problem with the order, if there is one.';
    case 'off_topic': return `This chat handles problems with order ${ORDER.id} only.`;
  }
}

const RISK = ['low', 'medium', 'high'] as const;
export const evidenceQuestions: Record<string, Question> = {
  recommendation: {
    type: 'choice',
    instructions: "Given the complaint, the customer's karma and the photo check results, what should the support team do?",
    criteria: {
      full_refund: 'Evidence supports the complaint: photos match the order, were taken after it and are not AI-generated or edited; or the customer is trusted and the evidence is at worst borderline.',
      partial_refund: 'The complaint is plausible but only part of the order is affected, or the evidence is mixed.',
      reject: 'Strong fraud signals: a photo is AI-generated, taken before the order, edited, or shows food not in this order. Low karma alone is never enough.',
      needs_human_review: 'No photos, a check failed, or the signals conflict, so a person should decide.',
    },
  },
  risk: {
    type: 'score',
    instructions: 'How likely is this complaint to be fraudulent?',
    criteria: ['Low: evidence and history support the customer', 'Medium: some doubtful signals', 'High: strong fraud signals'],
  },
};

export function verdict(a: Answers | undefined): { recommendation: string; confidence: number; risk: (typeof RISK)[number] } {
  const rec = a?.recommendation;
  const risk = a?.risk;
  const confident = rec?.type === 'choice' && (rec.confidence ?? 0) >= MIN_CONFIDENCE.recommendation;
  return {
    recommendation: confident ? rec.choice : 'needs_human_review',
    confidence: rec?.type === 'choice' ? rec.confidence ?? 0 : 0,
    risk: risk?.type === 'score' ? RISK[Math.min(2, Math.max(0, Math.round(risk.score)))] : 'medium',
  };
}
