/**
 * Acquisition from the openFDA enforcement API (CC0; see ADR-0013 for the
 * rights record). Each run fetches one report-date window per category, keeps
 * each page's verbatim records in R2 as evidence, and rewrites only records whose raw
 * bytes changed. A rolling cursor re-walks history so status changes on old
 * recalls (e.g. Ongoing → Terminated) are picked up without a full reload.
 */

import { RECALL_CATEGORIES, type OpenFdaEnforcementRecord, type RecallCategory } from '@data-foundry/recall-structuring';

import type { D1Database, R2Bucket } from './env.js';

import { ndjsonBundle, prepareRecall, rawRef, touchRecallStatement, writeRecallStatements, type Statement } from './store.js';

export const USER_AGENT = 'DataFoundryBot/1.0 (+https://data.aroqon.com/recalls; data@mail.proviciency.com)';
const PAGE = 1000;
/** openFDA refuses skip beyond 25,000; windows are sized far below that. */
const MAX_SKIP = 25_000;
const HISTORY_START = '2004-01-01';
const ROLLING_WINDOW_DAYS = 120;
const RECENT_WINDOW_DAYS = 45;
const D1_BATCH = 400;

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

async function runBatches(db: D1Database, statements: Statement[]): Promise<void> {
  for (let start = 0; start < statements.length; start += D1_BATCH) {
    const chunk = statements.slice(start, start + D1_BATCH);
    await db.batch(chunk.map((statement) => db.prepare(statement.sql).bind(...statement.params)));
  }
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
  try {
    for (let skip = 0; skip <= MAX_SKIP; skip += PAGE) {
      const page = await fetchPage(category, from, to, skip);
      if (page.results.length === 0) break;
      fetched += page.results.length;
      const prepared = await Promise.all(page.results.filter((record) => record.recall_number).map((record) => prepareRecall(category, record)));

      const existing = new Map<string, string>();
      for (let start = 0; start < prepared.length; start += 90) {
        const ids = prepared.slice(start, start + 90).map((item) => item.recall.recall_number);
        const rows = await env.DB.prepare(`SELECT recall_number, raw_sha256 FROM recall WHERE recall_number IN (${ids.map(() => '?').join(',')})`)
          .bind(...ids)
          .all<{ recall_number: string; raw_sha256: string }>();
        for (const row of rows.results) existing.set(row.recall_number, row.raw_sha256);
      }
      const statements: Statement[] = [];
      const toWrite = prepared.filter((item) => existing.get(item.recall.recall_number) !== item.rawSha256);
      for (const item of prepared) {
        if (existing.get(item.recall.recall_number) === item.rawSha256) statements.push(touchRecallStatement(item.recall.recall_number, now));
      }
      if (toWrite.length > 0) {
        // Evidence first: new and changed records as NDJSON, so each raw_ref is
        // an exact byte range in an object that already exists. Unchanged
        // records keep pointing at the bundle that first carried their bytes.
        const key = `recalls/openfda/${category}/${now.slice(0, 10)}/run-${runId}-${from}-${to}-${skip}.ndjson`;
        const bundle = ndjsonBundle(toWrite.map((item) => item.raw));
        await env.RAW_ARTIFACTS.put(key, bundle.body, {
          httpMetadata: { contentType: 'application/x-ndjson' },
          customMetadata: { source: 'openfda-enforcement', retrieved_at: now, window: `${from}..${to}`, skip: String(skip) },
        });
        artifactKeys.push(key);
        for (const [index, item] of toWrite.entries()) {
          if (existing.has(item.recall.recall_number)) changed += 1;
          else inserted += 1;
          const range = bundle.ranges[index] as { offset: number; length: number };
          statements.push(...writeRecallStatements(item, rawRef(key, range.offset, range.length), now));
        }
      }
      await runBatches(env.DB, statements);
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

/** One scheduled pass: the recent window for every category, then one rolling history window each. */
export async function scheduledSync(env: SyncEnv, today = new Date().toISOString().slice(0, 10)): Promise<WindowResult[]> {
  const results: WindowResult[] = [];
  for (const category of RECALL_CATEGORIES) {
    results.push(await syncWindow(env, category, addDays(today, -RECENT_WINDOW_DAYS), today));

    const cursor = await env.DB.prepare('SELECT next_from FROM sync_cursor WHERE category = ?').bind(category).first<{ next_from: string }>();
    const from = cursor?.next_from ?? HISTORY_START;
    const to = addDays(from, ROLLING_WINDOW_DAYS - 1);
    results.push(await syncWindow(env, category, from, to));
    const next = to >= today ? HISTORY_START : addDays(to, 1);
    await env.DB.prepare('INSERT INTO sync_cursor (category, next_from, updated_at) VALUES (?, ?, ?) ON CONFLICT (category) DO UPDATE SET next_from = excluded.next_from, updated_at = excluded.updated_at')
      .bind(category, next, new Date().toISOString())
      .run();
  }
  return results;
}
