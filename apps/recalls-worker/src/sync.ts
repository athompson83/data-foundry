/**
 * Acquisition from the openFDA enforcement API (CC0; see ADR-0015 for the
 * rights record). Each run fetches one report-date window per category, keeps
 * each page's verbatim records in R2 as evidence, and rewrites only records whose raw
 * bytes changed. A rolling cursor re-walks history so status changes on old
 * recalls (e.g. Ongoing → Terminated) are picked up without a full reload.
 */

import { isUsableRecallNumber, PARSER_VERSION, RECALL_CATEGORIES, type OpenFdaEnforcementRecord, type RecallCategory } from '@data-foundry/recall-structuring';

import type { D1Database, R2Bucket } from './env.js';

import { ndjsonBundle, prepareRecall, rawRef, touchRecallsStatement, writeRecallGroups, type Statement } from './store.js';

export const USER_AGENT = 'DataFoundryBot/1.0 (+https://data.aroqon.com/recalls; data@mail.proviciency.com)';
const PAGE = 1000;
/** openFDA refuses skip beyond 25,000; windows are sized far below that. */
const MAX_SKIP = 25_000;
/** openFDA's earliest enforcement report_date (measured 2026-09-26: 2012-06-20). */
const HISTORY_START = '2012-06-01';
const ROLLING_WINDOW_DAYS = 120;
/** A rolling window is skipped after this many failures, and stays visible in sync_run. */
const MAX_WINDOW_FAILURES = 3;
const RECENT_WINDOW_DAYS = 45;

export interface SyncEnv {
  readonly DB: D1Database;
  readonly RAW_ARTIFACTS: R2Bucket;
  readonly SOURCE_KILL_SWITCH?: string;
}

export interface WindowResult {
  readonly category: RecallCategory;
  readonly from: string;
  readonly to: string;
  readonly fetched: number;
  readonly inserted: number;
  readonly changed: number;
}

function ymd(date: string): string {
  return date.replaceAll('-', '');
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function fetchPage(category: RecallCategory, from: string, to: string, skip: number): Promise<{ results: OpenFdaEnforcementRecord[] }> {
  const url = `https://api.fda.gov/${category}/enforcement.json?search=report_date:[${ymd(from)}+TO+${ymd(to)}]&sort=report_date:asc&limit=${PAGE}&skip=${skip}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    if (response.status === 404) return { results: [] };
    if (response.ok) {
      const parsed = (await response.json()) as { results?: OpenFdaEnforcementRecord[] };
      return { results: parsed.results ?? [] };
    }
    if (response.status !== 429 && response.status < 500) throw new Error(`openFDA ${category} ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error(`openFDA ${category} unavailable after retries`);
}

/** Run statements as one D1 batch, which D1 executes as a single transaction. */
async function runStatements(db: D1Database, statements: readonly Statement[]): Promise<void> {
  await db.batch(statements.map((statement) => db.prepare(statement.sql).bind(...statement.params)));
}

export async function syncWindow(env: SyncEnv, category: RecallCategory, from: string, to: string, now = new Date().toISOString()): Promise<WindowResult> {
  if (env.SOURCE_KILL_SWITCH === '1') throw new Error('source kill switch engaged');
  const run = await env.DB.prepare('INSERT INTO sync_run (category, window_from, window_to, started_at) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(category, from, to, now)
    .first<{ id: number }>();
  const runId = run?.id ?? 0;
  const artifactKeys: string[] = [];
  let fetched = 0;
  let inserted = 0;
  let changed = 0;
  // First occurrence per recall number across the whole window (as the bulk
  // loader does), so duplicates straddling a page boundary cannot flip-flop.
  const seenInWindow = new Set<string>();
  try {
    for (let skip = 0; skip <= MAX_SKIP; skip += PAGE) {
      const page = await fetchPage(category, from, to, skip);
      if (page.results.length === 0) break;
      fetched += page.results.length;
      // Records without a real recall number yet ("N/A") are not published
      // until FDA assigns one, but they are still kept as evidence below.
      // One record per recall number per page, first occurrence (as the bulk
      // loader does), so a duplicate can never flip-flop between runs.
      // Every other fetched record (placeholder numbers, later duplicates) is
      // still archived below as evidence; only publication is deduplicated.
      const firstByNumber = new Map<string, OpenFdaEnforcementRecord>();
      const unpublishable: string[] = [];
      for (const record of page.results) {
        if (isUsableRecallNumber(record.recall_number) && !seenInWindow.has(record.recall_number)) {
          seenInWindow.add(record.recall_number);
          firstByNumber.set(record.recall_number, record);
        } else {
          unpublishable.push(JSON.stringify(record));
        }
      }
      const prepared = await Promise.all([...firstByNumber.values()].map((record) => prepareRecall(category, record)));

      const existing = new Map<string, string>();
      // A record is current only when both its source bytes and the parser
      // that derived it are current; a parser upgrade re-derives on next sight.
      const rows = await env.DB.prepare('SELECT recall_number, raw_sha256, parser_version FROM recall WHERE recall_number IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(prepared.map((item) => item.recall.recall_number)))
        .all<{ recall_number: string; raw_sha256: string; parser_version: string }>();
      for (const row of rows.results) existing.set(row.recall_number, `${row.raw_sha256}|${row.parser_version}`);
      const current = (item: (typeof prepared)[number]): boolean => existing.get(item.recall.recall_number) === `${item.rawSha256}|${PARSER_VERSION}`;

      const unchanged = prepared.filter(current);
      if (unchanged.length > 0) await runStatements(env.DB, [touchRecallsStatement(unchanged.map((item) => item.recall.recall_number), now)]);

      const toWrite = prepared.filter((item) => !current(item));
      if (toWrite.length > 0 || unpublishable.length > 0) {
        // Evidence first: new and changed records as NDJSON, so each raw_ref is
        // an exact byte range in an object that already exists. Unchanged
        // records keep pointing at the bundle that first carried their bytes.
        const key = `recalls/openfda/${category}/${now.slice(0, 10)}/run-${runId}-${from}-${to}-${skip}.ndjson`;
        // Publishable records first (their ranges are indexed by position),
        // then records held as evidence only.
        const bundle = ndjsonBundle([...toWrite.map((item) => item.raw), ...unpublishable]);
        await env.RAW_ARTIFACTS.put(key, bundle.body, {
          httpMetadata: { contentType: 'application/x-ndjson' },
          customMetadata: { source: 'openfda-enforcement', retrieved_at: now, window: `${from}..${to}`, skip: String(skip) },
        });
        artifactKeys.push(key);
        const writes = toWrite.map((prepared, index) => {
          const range = bundle.ranges[index] as { offset: number; length: number };
          return { prepared, rawRef: rawRef(key, range.offset, range.length) };
        });
        // Each group is one D1 batch, i.e. one transaction.
        for (const group of writeRecallGroups(writes, now)) await runStatements(env.DB, group);
        for (const item of toWrite) {
          if (existing.has(item.recall.recall_number)) changed += 1;
          else inserted += 1;
        }
      }
      if (page.results.length < PAGE) break;
    }
    await env.DB.prepare("UPDATE sync_run SET finished_at = ?, fetched = ?, inserted = ?, changed = ?, artifact_keys = ?, status = 'SUCCEEDED' WHERE id = ?")
      .bind(new Date().toISOString(), fetched, inserted, changed, JSON.stringify(artifactKeys), runId)
      .run();
    return { category, from, to, fetched, inserted, changed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE sync_run SET finished_at = ?, fetched = ?, inserted = ?, changed = ?, artifact_keys = ?, status = 'FAILED', error = ? WHERE id = ?")
      .bind(new Date().toISOString(), fetched, inserted, changed, JSON.stringify(artifactKeys), message.slice(0, 500), runId)
      .run();
    throw error;
  }
}

export interface WindowFailure {
  readonly category: RecallCategory;
  readonly from: string;
  readonly to: string;
  readonly error: string;
}

async function attempt(env: SyncEnv, category: RecallCategory, from: string, to: string): Promise<WindowResult | WindowFailure> {
  try {
    return await syncWindow(env, category, from, to);
  } catch (error) {
    // Already recorded as a FAILED sync_run; one window must not stop the rest.
    return { category, from, to, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * One scheduled pass: the recent window for every category, then one rolling
 * history window each. Windows are independent. A failed rolling window is
 * retried on the next cycle, and skipped only after MAX_WINDOW_FAILURES, so
 * one bad window can neither be silently skipped nor freeze the refresh.
 */
export async function scheduledSync(env: SyncEnv, today = new Date().toISOString().slice(0, 10)): Promise<Array<WindowResult | WindowFailure>> {
  const results: Array<WindowResult | WindowFailure> = [];
  if (env.SOURCE_KILL_SWITCH === '1') return results;
  for (const category of RECALL_CATEGORIES) {
    results.push(await attempt(env, category, addDays(today, -RECENT_WINDOW_DAYS), today));

    const cursor = await env.DB.prepare('SELECT next_from FROM sync_cursor WHERE category = ?').bind(category).first<{ next_from: string }>();
    const from = cursor?.next_from ?? HISTORY_START;
    const to = addDays(from, ROLLING_WINDOW_DAYS - 1);
    const rolling = await attempt(env, category, from, to);
    results.push(rolling);
    if ('error' in rolling) {
      // Retry the same window next cycle; only a window that has failed
      // repeatedly is skipped, so one bad window cannot freeze the refresh.
      const failures = await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_run WHERE category = ? AND window_from = ? AND window_to = ? AND status = 'FAILED'")
        .bind(category, from, to)
        .first<{ n: number }>();
      if ((failures?.n ?? 0) < MAX_WINDOW_FAILURES) continue;
    }
    const next = to >= today ? HISTORY_START : addDays(to, 1);
    await env.DB.prepare('INSERT INTO sync_cursor (category, next_from, updated_at) VALUES (?, ?, ?) ON CONFLICT (category) DO UPDATE SET next_from = excluded.next_from, updated_at = excluded.updated_at')
      .bind(category, next, new Date().toISOString())
      .run();
  }
  return results;
}
