import assert from 'node:assert/strict';
import { test } from 'node:test';
import { karmaScore } from './karma.ts';

const loyal = karmaScore({ totalOrders: 142, problemOrders: 3, flaggedReports: 0 });
const fresh = karmaScore({ totalOrders: 1, problemOrders: 0, flaggedReports: 0 });
const fraud = karmaScore({ totalOrders: 25, problemOrders: 14, flaggedReports: 8 });

test('ranks loyal > new > fraudster, with matching tiers', () => {
  assert.ok(loyal.score > fresh.score && fresh.score > fraud.score);
  assert.deepEqual([loyal.tier, fresh.tier, fraud.tier], ['trusted', 'normal', 'watch']);
});

test('new customer starts near the prior, not at 100', () => {
  assert.ok(fresh.score >= 55 && fresh.score <= 70, `got ${fresh.score}`);
});

test('a fake verdict lowers the score', () => {
  const after = karmaScore({ totalOrders: 25, problemOrders: 14, flaggedReports: 9 });
  assert.ok(after.score < fraud.score);
});

test('stays within 0..100 at the extremes', () => {
  for (const h of [
    { totalOrders: 0, problemOrders: 0, flaggedReports: 0 },
    { totalOrders: 5, problemOrders: 5, flaggedReports: 5 },
    { totalOrders: 10_000, problemOrders: 0, flaggedReports: 0 },
  ]) {
    const { score } = karmaScore(h);
    assert.ok(score >= 0 && score <= 100, `${JSON.stringify(h)} → ${score}`);
  }
});
