import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itemKey, route, verdict, type Answers } from './route.ts';

const answers = (next: string, confidence: number, issue = 'unclear', items: Record<string, number> = {}): Answers => ({
  next: { type: 'choice', choice: next, confidence },
  issue: { type: 'choice', choice: issue, confidence: 1 },
  ...Object.fromEntries(['butter-chicken', 'garlic-naan', 'chicken-biryani', 'gulab-jamun'].map((id) => [itemKey(id), { type: 'noul', noul: items[id] ?? 0.03 }])),
});
const fresh = { reportSent: false, photos: 0 };

test('confident question-type steps pass straight through', () => {
  assert.equal(route(answers('ask_which_items', 0.78, 'missing'), fresh).action, 'ask_which_items');
  assert.equal(route(answers('off_topic', 1), fresh).action, 'off_topic');
  assert.equal(route(answers('answer_question', 0.99), fresh).action, 'answer_question');
});

test('items: only nouls at or above the threshold become tool params', () => {
  const d = route(answers('ask_for_photo', 0.96, 'missing', { 'garlic-naan': 0.93, 'chicken-biryani': 0.94, 'gulab-jamun': 0.41 }), fresh);
  assert.deepEqual(d.items, ['garlic-naan', 'chicken-biryani']);
});

test('investigate needs a high bar, "other" and low confidence fall back to the LLM agent', () => {
  assert.equal(route(answers('investigate', 0.65, 'missing', { 'garlic-naan': 0.9 }), { reportSent: false, photos: 1 }).action, 'fallback');
  assert.equal(route(answers('ask_which_items', 0.45), fresh).action, 'fallback');
  assert.equal(route(answers('other', 1), fresh).action, 'fallback');
  assert.equal(route({}, fresh).action, 'fallback');
});

test('code overrides Jev on facts it can compute', () => {
  const clear = answers('investigate', 1, 'missing', { 'garlic-naan': 0.97 });
  assert.equal(route(answers('investigate', 1, 'quality', { 'garlic-naan': 0.97 }), { reportSent: false, photos: 0 }).action, 'ask_for_photo');
  assert.equal(route(clear, { reportSent: false, photos: 0 }).action, 'investigate');
  assert.equal(route(answers('investigate', 1, 'missing'), { reportSent: false, photos: 1 }).action, 'ask_which_items');
  assert.equal(route(answers('investigate', 1, 'unclear'), { reportSent: false, photos: 1 }).action, 'fallback');
  assert.equal(route(clear, { reportSent: false, photos: 1 }).action, 'investigate');
});

test('not delivered: investigates without photos and ignores stray item nouls', () => {
  const d = route(answers('investigate', 0.94, 'not_delivered', { 'chicken-biryani': 0.6 }), fresh);
  assert.equal(d.action, 'investigate');
  assert.deepEqual(d.items, []);
});

test('verdict: unsure or missing answers go to a human, risk score rounds to a label', () => {
  assert.deepEqual(verdict(undefined), { recommendation: 'needs_human_review', confidence: 0, risk: 'medium' });
  const sure = verdict({ recommendation: { type: 'choice', choice: 'reject', confidence: 0.9 }, risk: { type: 'score', score: 1.8 } });
  assert.equal(sure.recommendation, 'reject');
  assert.equal(sure.risk, 'high');
  assert.equal(verdict({ recommendation: { type: 'choice', choice: 'full_refund', confidence: 0.4 } }).recommendation, 'needs_human_review');
});

test('after the report: investigate / already logged / chit-chat are judged together', () => {
  const split: Answers = { ...answers('case_already_logged', 0.3, 'missing'), next: { type: 'choice', choice: 'case_already_logged', confidence: 0.3, probabilities: { investigate: 0.37, case_already_logged: 0.38, chit_chat: 0.25 } } };
  const d = route(split, { reportSent: true, photos: 1 });
  assert.equal(d.action, 'case_already_logged');
  assert.equal(d.confidence, 1);
  assert.equal(route(answers('investigate', 1, 'missing', { 'garlic-naan': 0.97 }), { reportSent: true, photos: 1 }).action, 'case_already_logged');
  assert.equal(route(answers('answer_question', 0.9), { reportSent: true, photos: 1 }).action, 'answer_question');
});
