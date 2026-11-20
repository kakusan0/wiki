// テスト用：ふつうの SQLite（node:sqlite）を D1 と同じ形で使う
import { DatabaseSync } from 'node:sqlite';
import type { DB, Stmt } from '../../src/worker/link';

export function memoryD1(): DB & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql: string, args: unknown[] = []): Stmt & { exec(): unknown } => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    exec: () => raw.prepare(sql).run(...(args as never[])),
    run: async () => raw.prepare(sql).run(...(args as never[])),
    first: async <T>() => (raw.prepare(sql).get(...(args as never[])) as T) ?? null,
    all: async <T>() => ({ results: raw.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return {
    raw,
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: Stmt[]) => {
      raw.exec('BEGIN');
      try { const out = stmts.map((s) => (s as unknown as { exec(): unknown }).exec()); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}
