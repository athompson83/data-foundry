/** Public read model over the existing sync ledger; never exposes errors or artifact locations. */
import type { D1Database } from './env.js';

interface Attempt {
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly window_from: string;
  readonly window_to: string;
}
interface SourceSync {
  readonly latest_attempt: Attempt | null;
  readonly last_successful_sync: string | null;
}

/** Only the caller's fixed source categories are queried. Highest ledger id is the latest created run. */
export async function sourceSync(db: D1Database, sources: Readonly<Record<string, string>>): Promise<Record<string, SourceSync>> {
  const categories = Object.values(sources);
  const rows = await db.prepare(`
    SELECT r.category, r.status, r.started_at, r.finished_at, r.window_from, r.window_to,
      (SELECT MAX(s.finished_at) FROM sync_run s WHERE s.category = r.category AND s.status = 'SUCCEEDED') AS last_successful_sync
    FROM sync_run r
    WHERE r.id IN (SELECT MAX(id) FROM sync_run WHERE category IN (${categories.map(() => '?').join(', ')}) GROUP BY category)
  `).bind(...categories).all<Attempt & { category: string; last_successful_sync: string | null }>();
  const byCategory = new Map(rows.results.map((row) => [row.category, row]));
  return Object.fromEntries(Object.entries(sources).map(([name, category]) => {
    const row = byCategory.get(category);
    return [name, {
      last_successful_sync: row?.last_successful_sync ?? null,
      latest_attempt: row ? {
        status: row.status, started_at: row.started_at, finished_at: row.finished_at,
        window_from: row.window_from, window_to: row.window_to,
      } : null,
    }];
  }));
}
