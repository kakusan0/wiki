// 乱数（mulberry32）。状態は 32bit の整数 1 つなので、ゲームの状態に入れて保存・再現できる
export function step(seed: number): [value: number, next: number] {
  const t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

// 状態を変えない乱数（CPU の気まぐれ用）。サイコロの流れを変えないために使う
export function hash01(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h ^= x | 0;
    h = Math.imul(h, 16777619);
  }
  return step(h)[0];
}
