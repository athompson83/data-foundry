/**
 * Keeps the consumer-product recall dataset current from its two official
 * machine sources: the CPSC Recall API (US government work) and Health
 * Canada's open-data recall index (Open Government Licence – Canada).
 *
 * Every run reads CPSC notices published or updated in the last
 * RECENT_DAYS days plus the full Health Canada index, and once a day the full
 * CPSC list, so corrections to old notices are picked up. The full list
 * (10,027 notices, 27.7 MB) is read in RecallDate windows of at most one year
 * and prepared in chunks, so no step holds the whole list in the isolate. Only new or changed
 * records (by raw SHA-256 and parser version) are written; their verbatim
 * bytes go to R2 first, so each row's raw_ref points at evidence that exists.
 * Before anything is parsed, the whole fetched response is archived in R2
 * under its SHA-256 (rule 10), so every run can be replayed exactly even for
 * records that were unchanged, out of scope or unusable.
 */

import { PARSER_VERSION } from '@data-foundry/product-recall-structuring';

import type { D1Database, R2Bucket } from './env.js';
import { isPublishable, prepareProductRecall, touchProductRecallsStatement, writeProductGroups, type PreparedProductRecall, type ProductAgency } from './product-store.js';
import { ndjsonBundle, rawRef, sha256Hex, type Statement } from './store.js';
import { USER_AGENT, addDays } from './sync.js';

export const CPSC_ENDPOINT = 'https://www.saferproducts.gov/RestWebServices/Recall';
export const HC_ENDPOINT = 'https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json';
export const RECENT_DAYS = 30;
/** Records per D1 batch group and per R2 bundle. */
const CHUNK = 500;
/** A full CPSC list below this is a truncated or failed read, never a real shrink. Nothing is deleted either way. */
export const MIN_FULL_CPSC = 9_000;
export const MIN_FULL_HC_CONSUMER = 4_500;

export interface ProductSyncEnv {
  readonly DB: D1Database;
  readonly RAW_ARTIFACTS: R2Bucket;
  readonly PRODUCT_RECALLS_KILL_SWITCH?: string;
}

export interface ProductSyncResult {
  readonly source: string;
  readonly fetched: number;
  readonly inserted: number;
  readonly changed: number;
  readonly error?: string;
}

export interface SourceArtifact {
  readonly key: string;
  readonly records: unknown;
}

/**
 * Fetch one source response, archive its exact bytes in R2 (content-addressed,
 * so an unchanged file is stored once), and only then parse it.
 */
async function fetchSource(url: string, agency: ProductAgency, bucket: R2Bucket, fetcher: typeof fetch, now: string): Promise<SourceArtifact> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
    if (response.ok) {
      const body = await response.text();
      const key = `product-recalls/source/${agency.toLowerCase()}/sha256-${await sha256Hex(body)}.json`;
      await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' }, customMetadata: { url, retrieved_at: now } });
      return { key, records: JSON.parse(body) as unknown };
    }
    if (response.status !== 429 && response.status < 500) throw new Error(`${new URL(url).host} ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error(`${new URL(url).host} unavailable after retries`);
}

export function cpscUrl(from?: string): string {
  return `${CPSC_ENDPOINT}?format=json${from ? `&LastPublishDateStart=${from}` : ''}`;
}

/** The full CPSC list as RecallDate windows: two before 2000 (small), then one per year (the largest is about 1.4 MB). */
export function cpscFullWindows(today: string): Array<{ label: string; url: string }> {
  const windows = [
    ['1900-01-01', '1989-12-31'],
    ['1990-01-01', '1999-12-31'],
  ];
  for (let year = 2000; year <= Number(today.slice(0, 4)); year += 1) windows.push([`${year}-01-01`, `${year}-12-31`]);
  return windows.map(([start, end]) => ({
    label: `full:${start}..${end}`,
    url: `${CPSC_ENDPOINT}?format=json&RecallDateStart=${start}&RecallDateEnd=${end}`,
  }));
}

async function runStatements(db: D1Database, statements: readonly Statement[]): Promise<void> {
  await db.batch(statements.map((statement) => db.prepare(statement.sql).bind(...statement.params)));
}

/** Write one agency's fetched records: evidence to R2, then only new or changed rows to D1. */
/**
 * Sync runs recorded under `product:<agency>` are what the public freshness field reads. A window of
 * the full CPSC pass is recorded under `product-window:CPSC` instead; the pass records one
 * `product:CPSC` run only after every window and the full-list floor have succeeded.
 */
export async function ingestRecords(env: ProductSyncEnv, agency: ProductAgency, records: readonly unknown[], window: string, now: string, sourceArtifact?: string, category = `product:${agency}`): Promise<ProductSyncResult> {
  const source = category;
  const run = await env.DB.prepare('INSERT INTO sync_run (category, window_from, window_to, started_at) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(source, window, now.slice(0, 10), now)
    .first<{ id: number }>();
  const runId = run?.id ?? 0;
  const artifactKeys: string[] = sourceArtifact ? [sourceArtifact] : [];
  let inserted = 0;
  let changed = 0;
  try {
    // Prepared one bounded chunk at a time, so the serialised raw and structured forms of the whole
    // response are never held at once. First occurrence per id wins, so a duplicate cannot flip-flop.
    const seen = new Set<string>();
    // The CPSC API answers an invalid or failed request with HTTP 200 and an error object instead of recalls.
    // A non-empty response in which no record is a CPSC notice is a failed fetch, never an empty window.
    if (agency === 'CPSC' && records.length > 0 && !records.some((record) => isPublishable(agency, record))) {
      throw new Error(`CPSC response of ${records.length} record(s) holds no recall notice (error body?)`);
    }
    for (let start = 0; start < records.length; start += CHUNK) {
      const chunk: PreparedProductRecall[] = [];
      for (const record of records.slice(start, start + CHUNK)) {
        if (!isPublishable(agency, record)) continue;
        const prepared = await prepareProductRecall(agency, record);
        if (seen.has(prepared.recall.id)) continue;
        seen.add(prepared.recall.id);
        chunk.push(prepared);
      }
      if (chunk.length === 0) continue;
      const rows = await env.DB.prepare('SELECT id, raw_sha256, parser_version FROM product_recall WHERE id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(chunk.map((item) => item.recall.id)))
        .all<{ id: string; raw_sha256: string; parser_version: string }>();
      const existing = new Map(rows.results.map((row) => [row.id, `${row.raw_sha256}|${row.parser_version}`]));
      const current = (item: PreparedProductRecall): boolean => existing.get(item.recall.id) === `${item.rawSha256}|${PARSER_VERSION}`;
      const unchanged = chunk.filter(current);
      if (unchanged.length > 0) await runStatements(env.DB, [touchProductRecallsStatement(unchanged.map((item) => item.recall.id), now)]);
      const toWrite = chunk.filter((item) => !current(item));
      if (toWrite.length === 0) continue;
      const key = `product-recalls/${agency.toLowerCase()}/${now.slice(0, 10)}/run-${runId}-${start}.ndjson`;
      const bundle = ndjsonBundle(toWrite.map((item) => item.raw));
      await env.RAW_ARTIFACTS.put(key, bundle.body, {
        httpMetadata: { contentType: 'application/x-ndjson' },
        customMetadata: { source, retrieved_at: now, window },
      });
      artifactKeys.push(key);
      const writes = toWrite.map((item, index) => {
        const range = bundle.ranges[index] as { offset: number; length: number };
        return { prepared: item, rawRef: rawRef(key, range.offset, range.length) };
      });
      for (const group of writeProductGroups(writes, now)) await runStatements(env.DB, group);
      for (const item of toWrite) {
        if (existing.has(item.recall.id)) changed += 1;
        else inserted += 1;
      }
    }
    await env.DB.prepare("UPDATE sync_run SET finished_at = ?, fetched = ?, inserted = ?, changed = ?, artifact_keys = ?, status = 'SUCCEEDED' WHERE id = ?")
      .bind(new Date().toISOString(), records.length, inserted, changed, JSON.stringify(artifactKeys), runId)
      .run();
    return { source, fetched: records.length, inserted, changed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE sync_run SET finished_at = ?, fetched = ?, inserted = ?, changed = ?, artifact_keys = ?, status = 'FAILED', error = ? WHERE id = ?")
      .bind(new Date().toISOString(), records.length, inserted, changed, JSON.stringify(artifactKeys), message.slice(0, 500), runId)
      .run();
    throw error;
  }
}

async function attempt(source: string, task: () => Promise<ProductSyncResult>): Promise<ProductSyncResult> {
  try {
    return await task();
  } catch (error) {
    return { source, fetched: 0, inserted: 0, changed: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * One scheduled pass. `full` also re-reads the whole CPSC list (the Cron
 * handler passes it on the first run of each UTC day). Sources are
 * independent: one failing never stops the other.
 */
export async function scheduledProductSync(env: ProductSyncEnv, options: { full: boolean; today?: string; fetcher?: typeof fetch } = { full: false }): Promise<ProductSyncResult[]> {
  if (env.PRODUCT_RECALLS_KILL_SWITCH === '1') return [];
  const fetcher = options.fetcher ?? fetch;
  const now = new Date().toISOString();
  const today = options.today ?? now.slice(0, 10);
  const results: ProductSyncResult[] = [];
  results.push(
    await attempt('product:CPSC', async () => {
      if (!options.full) {
        const from = addDays(today, -RECENT_DAYS);
        const { key, records } = await fetchSource(cpscUrl(from), 'CPSC', env.RAW_ARTIFACTS, fetcher, now);
        if (!Array.isArray(records)) throw new Error('CPSC response is not a JSON array');
        return ingestRecords(env, 'CPSC', records, from, now, key);
      }
      // One window at a time: each is archived, ingested and released before the next is fetched.
      const run = await env.DB.prepare("INSERT INTO sync_run (category, window_from, window_to, started_at) VALUES ('product:CPSC', 'full', ?, ?) RETURNING id")
        .bind(today, now)
        .first<{ id: number }>();
      const keys: string[] = [];
      let fetched = 0;
      let inserted = 0;
      let changed = 0;
      try {
        for (const window of cpscFullWindows(today)) {
          const { key, records } = await fetchSource(window.url, 'CPSC', env.RAW_ARTIFACTS, fetcher, now);
          keys.push(key);
          if (!Array.isArray(records)) throw new Error(`CPSC ${window.label} response is not a JSON array`);
          const result = await ingestRecords(env, 'CPSC', records, window.label, now, key, 'product-window:CPSC');
          fetched += result.fetched;
          inserted += result.inserted;
          changed += result.changed;
        }
        if (fetched < MIN_FULL_CPSC) throw new Error(`CPSC full list has only ${fetched} records`);
      } catch (error) {
        await env.DB.prepare("UPDATE sync_run SET finished_at = ?, fetched = ?, inserted = ?, changed = ?, artifact_keys = ?, status = 'FAILED', error = ? WHERE id = ?")
          .bind(new Date().toISOString(), fetched, inserted, changed, JSON.stringify(keys), (error instanceof Error ? error.message : String(error)).slice(0, 500), run?.id ?? 0)
          .run();
        throw error;
      }
      await env.DB.prepare("UPDATE sync_run SET finished_at = ?, fetched = ?, inserted = ?, changed = ?, artifact_keys = ?, status = 'SUCCEEDED' WHERE id = ?")
        .bind(new Date().toISOString(), fetched, inserted, changed, JSON.stringify(keys), run?.id ?? 0)
        .run();
      return { source: 'product:CPSC', fetched, inserted, changed };
    }),
  );
  results.push(
    await attempt('product:HC', async () => {
      const { key, records } = await fetchSource(HC_ENDPOINT, 'HC', env.RAW_ARTIFACTS, fetcher, now);
      if (!Array.isArray(records)) throw new Error('Health Canada response is not a JSON array');
      const inScope = records.filter((record) => isPublishable('HC', record));
      if (inScope.length < MIN_FULL_HC_CONSUMER) throw new Error(`Health Canada index has only ${inScope.length} consumer-product records`);
      return ingestRecords(env, 'HC', inScope, 'full', now, key);
    }),
  );
  return results;
}
