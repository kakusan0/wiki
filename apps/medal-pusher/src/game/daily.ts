// 毎日のメダル：続けて来るほど増える（7 日で一回り）
export const DAILY = [50, 80, 100, 150, 200, 250, 500];
export interface DailyState { last: string | null; streak: number }

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prevDay = (key: string) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d - 1)); };

export function canClaim(s: DailyState, today: string) { return s.last !== today; }

// 今日の受け取りが何日目か（0〜6）
export function nextIndex(s: DailyState, today: string): number {
  if (s.last === today) return (s.streak - 1 + 7) % 7;
  if (s.last && prevDay(today) === s.last) return s.streak % 7;
  return 0;
}

export function claim(s: DailyState, today: string): { state: DailyState; amount: number } | null {
  if (!canClaim(s, today)) return null;
  const i = nextIndex(s, today);
  return { state: { last: today, streak: i + 1 }, amount: DAILY[i] };
}
