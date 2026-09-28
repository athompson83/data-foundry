/**
 * Governed intake for identifier candidates proposed by the local collector
 * (apps/local-collector; docs/decisions/ADR-0017-local-collector-extraction-intake.md).
 *
 *   POST /v1/intake/product-recalls/identifiers   (api host, ingestion credential)
 *
 * The collector's model and its local checks are untrusted. For every
 * candidate this Worker independently
 *
 * 1. authenticates an ingestion-scoped credential (not a customer API key, not an admin token) and checks that
 *    it lists the notice's source;
 * 2. refuses when intake is closed, the dataset's kill switch is set or the source is withdrawn;
 * 3. requires the submitted raw_sha256 to equal the stored record's, then re-reads that record from R2 and
 *    verifies its digest (the text checked is always the stored evidence, never text the client sends);
 * 4. re-runs the deterministic acceptance rules (identifier-candidates.ts) and derives the label itself;
 * 5. skips identifiers the agency parser already indexes, and stores the rest idempotently, with the
 *    extractor, model digest, prompt hash, credential and exact source span.
 *
 * Accepted candidates are not published by acceptance: they are served only while EXTRACTED_IDENTIFIERS_OPEN
 * is "1" (the quality gate), labelled as extracted, and every one can be withdrawn by extractor version.
 */

import { decideIdentifierInRecord, IDENTIFIER_TASK, type StructuredProductRecall } from '@data-foundry/product-recall-structuring';

import type { D1Database, Env, R2Bucket } from './env.js';
import { BadRequest } from './api.js';
import { loadRawRecord, PRODUCT_ID } from './product-api.js';
import { sha256Hex } from './store.js';

export const INGEST_TOKEN_PREFIX = 'dfi_';
/** Sources the intake knows, with the notice-id prefix their records carry. Rights: the source's rights record. */
export const INTAKE_SOURCES: Readonly<Record<string, { readonly idPrefix: string; readonly rightsRecord: string }>> = {
  'cpsc-recalls': { idPrefix: 'cpsc-', rightsRecord: 'docs/sources/cpsc-recalls-rights-record-20260927.md' },
};
/**
 * Extractor builds whose accepted candidates may be served (ADR-0017): each passed the pre-registered bar in
 * apps/local-collector/benchmark/QUALITY_BAR.md on held-out data as this exact tuple. Output from any other version,
 * model build or prompt is still accepted and stored as evidence, but never served. Adding an entry is a reviewed
 * change that cites its benchmark (tooling/test/local-collector.test.ts checks the prompt hash against the collector).
 */
/**
 * The extraction-behaviour fingerprint this Worker runs: acceptance rules (TypeScript and the collector's mirror),
 * extractor schema, truncation and prompt assembly, model options and generation defaults
 * (tooling/scripts/extraction-behaviour.ts). Stamped on every accepted row; CI fails when those files change until
 * the benchmark is re-run and this constant and the entry below are updated.
 */
export const EXTRACTION_BEHAVIOUR_SHA256 = 'bb9a65a6f4217c44a76307a3006d7143de51dd2d2a7ce0cd922e033ceb058a72';

export const PUBLISHABLE_EXTRACTORS: ReadonlyArray<{ readonly version: string; readonly model: string; readonly modelDigest: string; readonly promptSha256: string; readonly behaviourSha256: string; readonly benchmark: string }> = [
  {
    version: 'cpsc-product-identifiers@1/prompt-3',
    model: 'qwen3.5:4b',
    // The full manifest digest the benchmark ran on (apps/local-collector/benchmark/data/model.json), without "sha256:".
    modelDigest: '2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd',
    promptSha256: 'e4a912fb71b2f0edbcb5929cd483cad57b7a8e9ebc419ea3fef3f3e19ee69d53',
    // The acceptance rules re-scored from the stored predictions (run_benchmark.py --score-only): identical report.
    behaviourSha256: 'bb9a65a6f4217c44a76307a3006d7143de51dd2d2a7ce0cd922e033ceb058a72',
    benchmark: 'apps/local-collector/benchmark/RESULTS.md (held-out precision 38/38, 0/18 negative false positives)',
  },
];

/** Whether a submitted extractor tuple is exactly a publishable build (the JavaScript twin of the SQL clause below). */
export function isPublishableExtractor(extractor: { readonly version: string; readonly model: string; readonly model_digest: string; readonly prompt_sha256: string }): boolean {
  const digest = extractor.model_digest.replace(/^sha256:/, '');
  // Rows are stamped with this Worker's behaviour fingerprint, so a build is publishable only under the behaviour it was benchmarked with.
  return PUBLISHABLE_EXTRACTORS.some((entry) => entry.version === extractor.version && entry.model === extractor.model && entry.modelDigest === digest && entry.promptSha256 === extractor.prompt_sha256 && entry.behaviourSha256 === EXTRACTION_BEHAVIOUR_SHA256);
}

/** SQL condition (on alias `e`) matching rows produced by a publishable extractor build, with its bind values. */
export function publishableExtractorClause(): { sql: string; binds: string[] } {
  if (PUBLISHABLE_EXTRACTORS.length === 0) return { sql: '0', binds: [] };
  return {
    // The whole tuple, compared exactly: version, model name, full model digest, prompt hash and behaviour fingerprint.
    sql: `(${PUBLISHABLE_EXTRACTORS.map(() => "(e.extractor_version = ? AND e.model = ? AND replace(e.model_digest, 'sha256:', '') = ? AND e.prompt_sha256 = ? AND e.behaviour_sha256 = ?)").join(' OR ')})`,
    binds: PUBLISHABLE_EXTRACTORS.flatMap((entry) => [entry.version, entry.model, entry.modelDigest, entry.promptSha256, entry.behaviourSha256]),
  };
}

export const MAX_INTAKE_BYTES = 262_144;
export const MAX_INTAKE_NOTICES = 25;
export const MAX_CANDIDATES_PER_NOTICE = 60;

export interface IngestCredential {
  readonly id: string;
  readonly sources: readonly string[];
}

export class IntakeRefused extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function intakeOpen(env: Env): boolean {
  return env.COLLECTOR_INTAKE_OPEN === '1';
}

/** Sources an operator has withdrawn from intake (comma-separated source keys), independent of credentials. */
export function withdrawnSources(env: Env): Set<string> {
  return new Set((env.INTAKE_WITHDRAWN_SOURCES ?? '').split(',').map((value) => value.trim()).filter(Boolean));
}

export function mintIngestToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const out: string[] = [];
  while (out.length < 40) {
    for (const byte of crypto.getRandomValues(new Uint8Array(64))) {
      if (byte < 248 && out.length < 40) out.push(alphabet[byte % 62] as string);
    }
  }
  return `${INGEST_TOKEN_PREFIX}${out.join('')}`;
}

export async function createIngestCredential(db: D1Database, label: string, sources: readonly string[], now: string): Promise<{ id: string; token: string }> {
  if (!/^[\w .@-]{3,80}$/.test(label)) throw new BadRequest('label must be 3–80 letters, digits, spaces or ._@-');
  if (sources.length === 0 || sources.some((source) => !(source in INTAKE_SOURCES))) throw new BadRequest(`sources must be a comma-separated subset of: ${Object.keys(INTAKE_SOURCES).join(', ')}`);
  const token = mintIngestToken();
  const id = `ic_${crypto.randomUUID()}`;
  await db.prepare('INSERT INTO ingest_credential (id, token_sha256, label, sources, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, await sha256Hex(token), label, JSON.stringify([...new Set(sources)]), now).run();
  return { id, token };
}

export async function revokeIngestCredential(db: D1Database, id: string, now: string): Promise<boolean> {
  const row = await db.prepare('UPDATE ingest_credential SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING id').bind(now, id).first<{ id: string }>();
  return Boolean(row);
}

async function findCredential(db: D1Database, request: Request): Promise<IngestCredential | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')?.trim() ?? '');
  const token = match?.[1] ?? '';
  if (!token.startsWith(INGEST_TOKEN_PREFIX) || token.length !== INGEST_TOKEN_PREFIX.length + 40) return null;
  const row = await db.prepare('SELECT id, sources FROM ingest_credential WHERE token_sha256 = ? AND revoked_at IS NULL').bind(await sha256Hex(token)).first<{ id: string; sources: string }>();
  return row ? { id: row.id, sources: JSON.parse(row.sources) as string[] } : null;
}

interface CandidateInput {
  readonly value: string;
  readonly field: string;
  readonly label?: string;
}

interface NoticeInput {
  readonly recall_id: string;
  readonly raw_sha256: string;
  readonly candidates: readonly CandidateInput[];
}

interface Extractor {
  readonly version: string;
  readonly model: string;
  readonly model_digest: string;
  readonly prompt_sha256: string;
}

const str = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value);

function parseBody(body: unknown): { extractor: Extractor; notices: NoticeInput[] } {
  if (!body || typeof body !== 'object') throw new BadRequest('body must be a JSON object');
  const { task, extractor, notices } = body as Record<string, unknown>;
  if (task !== IDENTIFIER_TASK) throw new BadRequest(`task must be ${IDENTIFIER_TASK}`);
  const e = extractor as Record<string, unknown> | undefined;
  if (!e || !str(e['version'], /^[\w.@/:+-]{3,100}$/) || !str(e['model'], /^[\w.:/-]{2,100}$/) || !str(e['model_digest'], /^(?:sha256:)?[0-9a-f]{12,64}$/) || !str(e['prompt_sha256'], /^[0-9a-f]{64}$/)) {
    throw new BadRequest('extractor must have version, model, model_digest and prompt_sha256');
  }
  if (/cloud/i.test(e['model'] as string)) throw new BadRequest('cloud models are not accepted');
  if (!Array.isArray(notices) || notices.length === 0 || notices.length > MAX_INTAKE_NOTICES) throw new BadRequest(`notices must be an array of 1–${MAX_INTAKE_NOTICES}`);
  const parsed = notices.map((notice): NoticeInput => {
    const n = notice as Record<string, unknown>;
    if (!n || !str(n['recall_id'], /^[a-z0-9-]{3,20}$/) || !str(n['raw_sha256'], /^[0-9a-f]{64}$/) || !Array.isArray(n['candidates']) || (n['candidates'] as unknown[]).length > MAX_CANDIDATES_PER_NOTICE) {
      throw new BadRequest(`each notice needs recall_id, raw_sha256 and up to ${MAX_CANDIDATES_PER_NOTICE} candidates`);
    }
    const candidates = (n['candidates'] as unknown[]).map((candidate) => {
      const c = candidate as Record<string, unknown>;
      if (!c || typeof c['value'] !== 'string' || (c['value'] as string).length > 60 || typeof c['field'] !== 'string' || (c['field'] as string).length > 40) {
        throw new BadRequest('each candidate needs a value (≤60 chars) and a field');
      }
      return { value: c['value'] as string, field: c['field'] as string, ...(typeof c['label'] === 'string' ? { label: (c['label'] as string).slice(0, 20) } : {}) };
    });
    return { recall_id: n['recall_id'] as string, raw_sha256: n['raw_sha256'] as string, candidates };
  });
  return { extractor: { version: e['version'] as string, model: e['model'] as string, model_digest: e['model_digest'] as string, prompt_sha256: e['prompt_sha256'] as string }, notices: parsed };
}

type CandidateStatus = 'accepted' | 'replayed' | 'duplicate_of_agency_fact' | 'rejected';

interface CandidateResult {
  readonly value: string;
  readonly field: string;
  readonly status: CandidateStatus;
  readonly reason?: string;
  /** Where the server found the value in the stored record (may differ from the extractor's claimed field). */
  readonly source_field?: string;
  readonly key?: string;
  readonly label?: string;
  readonly label_matches_extractor?: boolean;
  readonly span?: readonly [number, number];
}

interface NoticeResult {
  readonly recall_id: string;
  readonly status: 'checked' | 'unknown_notice' | 'stale_source' | 'source_not_allowed';
  readonly candidates: CandidateResult[];
}

function sourceOf(recallId: string): string | null {
  return Object.entries(INTAKE_SOURCES).find(([, source]) => recallId.startsWith(source.idPrefix))?.[0] ?? null;
}

async function checkNotice(db: D1Database, bucket: R2Bucket, notice: NoticeInput, credential: IngestCredential, extractor: Extractor, withdrawn: Set<string>, now: string): Promise<NoticeResult> {
  const reject = (status: NoticeResult['status'], reason: string): NoticeResult => ({
    recall_id: notice.recall_id,
    status,
    candidates: notice.candidates.map((candidate) => ({ value: candidate.value, field: candidate.field, status: 'rejected', reason })),
  });
  const source = sourceOf(notice.recall_id);
  if (!source || !credential.sources.includes(source) || withdrawn.has(source) || !PRODUCT_ID.test(notice.recall_id)) return reject('source_not_allowed', 'source_not_allowed');
  const row = await db.prepare('SELECT id, raw_ref, raw_sha256, structured FROM product_recall WHERE id = ?').bind(notice.recall_id).first<{ id: string; raw_ref: string; raw_sha256: string; structured: string }>();
  if (!row) return reject('unknown_notice', 'unknown_notice');
  // The candidate must have been extracted from exactly the bytes the dataset holds now.
  if (row.raw_sha256 !== notice.raw_sha256) return reject('stale_source', 'stale_source');
  const raw = await loadRawRecord(bucket, row);
  const agencyKeys = new Set((JSON.parse(row.structured) as StructuredProductRecall).identifiers.model_keys);
  const results: CandidateResult[] = [];
  const seen = new Set<string>();
  for (const candidate of notice.candidates) {
    // The field claim is a hint; the server finds where the value is printed in the stored record.
    const decision = decideIdentifierInRecord(raw, candidate.value, candidate.field);
    if (!decision.ok) {
      results.push({ value: candidate.value, field: candidate.field, status: 'rejected', reason: decision.reason });
      continue;
    }
    const base = { value: candidate.value, field: candidate.field, source_field: decision.field, key: decision.key, label: decision.label, label_matches_extractor: candidate.label === decision.label, span: [decision.start, decision.end] as const };
    if (agencyKeys.has(decision.key)) {
      results.push({ ...base, status: 'duplicate_of_agency_fact' });
      continue;
    }
    if (seen.has(decision.key)) {
      results.push({ ...base, status: 'replayed' });
      continue;
    }
    seen.add(decision.key);
    const inserted = await db
      .prepare(`INSERT INTO product_recall_extracted_key (recall_id, raw_sha256, extractor_version, kind, value_key, printed, label, source_field, span_start, span_end, model, model_digest, prompt_sha256, behaviour_sha256, credential_id, status, submitted_at)
        VALUES (?, ?, ?, 'model', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?) ON CONFLICT DO NOTHING RETURNING recall_id`)
      .bind(row.id, row.raw_sha256, extractor.version, decision.key, candidate.value, decision.label, decision.field, decision.start, decision.end, extractor.model, extractor.model_digest, extractor.prompt_sha256, EXTRACTION_BEHAVIOUR_SHA256, credential.id, now)
      .first<{ recall_id: string }>();
    results.push({ ...base, status: inserted ? 'accepted' : 'replayed' });
  }
  return { recall_id: notice.recall_id, status: 'checked', candidates: results };
}

export async function handleIntake(env: Env, request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!intakeOpen(env)) throw new IntakeRefused(503, 'intake_closed', 'Extraction intake is closed.');
  const credential = await findCredential(env.DB, request);
  if (!credential) throw new IntakeRefused(401, 'invalid_ingest_credential', 'Send an ingestion credential as "Authorization: Bearer dfi_…".');
  if (env.PRODUCT_RECALLS_KILL_SWITCH === '1') throw new IntakeRefused(503, 'source_withdrawn', 'The product-recall sources are withdrawn.');
  const idempotencyKey = request.headers.get('idempotency-key') ?? '';
  if (!/^[0-9a-f]{64}$/.test(idempotencyKey)) throw new BadRequest('Idempotency-Key must be 64 lowercase hex characters');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_INTAKE_BYTES) throw new IntakeRefused(413, 'too_large', `Bodies are limited to ${MAX_INTAKE_BYTES} bytes.`);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_INTAKE_BYTES) throw new IntakeRefused(413, 'too_large', `Bodies are limited to ${MAX_INTAKE_BYTES} bytes.`);
  const bodySha = await sha256Hex(text);
  const reservation = await reserveSubmission(env.DB, credential.id, idempotencyKey, bodySha);
  if ('replay' in reservation) return { status: 200, body: reservation.replay };
  try {
    const response = await processSubmission(env, credential, text);
    const all = (response.results as NoticeResult[]).flatMap((result) => result.candidates);
    await env.DB.prepare('UPDATE extraction_submission SET items = ?, accepted = ?, replayed = ?, rejected = ?, response = ? WHERE id = ?')
      .bind(all.length, response.accepted, response.replayed, response.rejected, JSON.stringify(response), reservation.id)
      .run();
    return { status: 200, body: response };
  } catch (error) {
    // Release the reservation so a retry of the same payload can proceed; nothing it wrote is lost (inserts are idempotent).
    await env.DB.prepare('DELETE FROM extraction_submission WHERE id = ? AND response IS NULL').bind(reservation.id).run();
    throw error;
  }
}

/** A reservation older than this, still without a response, belongs to a request that died; a retry may take it over. */
export const STALE_RESERVATION_MS = 120_000;

/**
 * Claims (credential, Idempotency-Key) before any candidate is written. Scoped to the credential: another credential's
 * use of the same key is a separate submission. A completed key replays its stored response; the same key with a
 * different body is refused (409); a key another request is still processing answers 503 so the client retries.
 */
async function reserveSubmission(db: D1Database, credentialId: string, key: string, bodySha: string): Promise<{ id: number } | { replay: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const now = new Date();
    const reserved = await db
      .prepare('INSERT INTO extraction_submission (credential_id, idempotency_key, body_sha256, received_at) VALUES (?, ?, ?, ?) ON CONFLICT (credential_id, idempotency_key) DO NOTHING RETURNING id')
      .bind(credentialId, key, bodySha, now.toISOString())
      .first<{ id: number }>();
    if (reserved) return reserved;
    const existing = await db.prepare('SELECT id, body_sha256, received_at, response FROM extraction_submission WHERE credential_id = ? AND idempotency_key = ?').bind(credentialId, key).first<{ id: number; body_sha256: string; received_at: string; response: string | null }>();
    if (!existing) continue; // released between the insert and the read: try once more
    if (existing.body_sha256 !== bodySha) throw new IntakeRefused(409, 'idempotency_mismatch', 'This Idempotency-Key was already used with a different body.');
    if (existing.response !== null) return { replay: { ...(JSON.parse(existing.response) as Record<string, unknown>), idempotent_replay: true } };
    if (now.getTime() - Date.parse(existing.received_at) < STALE_RESERVATION_MS) throw new IntakeRefused(503, 'submission_in_progress', 'A request with this Idempotency-Key is still being processed; retry shortly.');
    const takenOver = await db.prepare('UPDATE extraction_submission SET received_at = ? WHERE id = ? AND response IS NULL AND received_at = ? RETURNING id').bind(now.toISOString(), existing.id, existing.received_at).first<{ id: number }>();
    if (takenOver) return takenOver;
  }
  throw new IntakeRefused(503, 'submission_in_progress', 'A request with this Idempotency-Key is still being processed; retry shortly.');
}

async function processSubmission(env: Env, credential: IngestCredential, text: string): Promise<Record<string, unknown> & { accepted: number; replayed: number; rejected: number; results: NoticeResult[] }> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadRequest('body is not valid JSON');
  }
  const { extractor, notices } = parseBody(body);
  const withdrawn = withdrawnSources(env);
  const now = new Date().toISOString();
  const results: NoticeResult[] = [];
  for (const notice of notices) results.push(await checkNotice(env.DB, env.RAW_ARTIFACTS, notice, credential, extractor, withdrawn, now));
  const all = results.flatMap((result) => result.candidates);
  const count = (status: CandidateStatus) => all.filter((candidate) => candidate.status === status).length;
  const response = {
    task: IDENTIFIER_TASK,
    extractor_version: extractor.version,
    accepted: count('accepted'),
    replayed: count('replayed'),
    duplicate_of_agency_fact: count('duplicate_of_agency_fact'),
    rejected: count('rejected'),
    // Served only when the quality gate is open AND this exact build is allowlisted (the same test every query applies).
    publishable_build: isPublishableExtractor(extractor),
    published: env.EXTRACTED_IDENTIFIERS_OPEN === '1' && isPublishableExtractor(extractor),
    results,
  };
  return response;
}

/** Operator withdrawal of every accepted candidate from one extractor version (optionally one notice). Rows are kept; restoreExtractions reverses it. */
export async function withdrawExtractions(db: D1Database, extractorVersion: string, recallId: string | null, now: string): Promise<number> {
  if (!/^[\w.@/:+-]{3,100}$/.test(extractorVersion)) throw new BadRequest('extractor_version is required');
  const rows = await db
    .prepare(`UPDATE product_recall_extracted_key SET status = 'withdrawn', withdrawn_at = ? WHERE extractor_version = ? AND status = 'accepted' ${recallId ? 'AND recall_id = ?' : ''} RETURNING recall_id`)
    .bind(now, extractorVersion, ...(recallId ? [recallId] : []))
    .all<{ recall_id: string }>();
  return rows.results.length;
}

/** Reverses withdrawExtractions for one extractor version (optionally one notice): withdrawn rows are accepted again. */
export async function restoreExtractions(db: D1Database, extractorVersion: string, recallId: string | null): Promise<number> {
  if (!/^[\w.@/:+-]{3,100}$/.test(extractorVersion)) throw new BadRequest('extractor_version is required');
  const rows = await db
    .prepare(`UPDATE product_recall_extracted_key SET status = 'accepted', withdrawn_at = NULL WHERE extractor_version = ? AND status = 'withdrawn' ${recallId ? 'AND recall_id = ?' : ''} RETURNING recall_id`)
    .bind(extractorVersion, ...(recallId ? [recallId] : []))
    .all<{ recall_id: string }>();
  return rows.results.length;
}
