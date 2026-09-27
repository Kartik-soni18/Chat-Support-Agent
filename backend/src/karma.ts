const PRIOR = 60;
const BASELINE_COMPLAINT_RATE = 0.1;
const TRUST_RAMP = 10;
const TIERS = { trusted: 80, normal: 50 };

export type History = { totalOrders: number; problemOrders: number; flaggedReports: number };
export type Karma = { score: number; tier: 'trusted' | 'normal' | 'watch'; complaintRate: number; falseRate: number };

export function karmaScore({ totalOrders, problemOrders, flaggedReports }: History): Karma {
  const complaintRate = (problemOrders + 1) / (totalOrders + 10);
  const falseRate = flaggedReports / (problemOrders + 2);
  const raw = 100 * (1 - falseRate) * (1 - Math.max(0, complaintRate - BASELINE_COMPLAINT_RATE));
  const score = raw < PRIOR ? raw : PRIOR + (raw - PRIOR) * (totalOrders / (totalOrders + TRUST_RAMP));
  const rounded = Math.round(Math.min(100, Math.max(0, score)));
  const tier = rounded >= TIERS.trusted ? 'trusted' : rounded >= TIERS.normal ? 'normal' : 'watch';
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { score: rounded, tier, complaintRate: round2(complaintRate), falseRate: round2(falseRate) };
}
