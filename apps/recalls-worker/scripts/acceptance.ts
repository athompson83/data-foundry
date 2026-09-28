/**
 * Authenticated production acceptance for the recalls API (both datasets).
 *
 * Issues one key for the dedicated internal acceptance customer through the
 * supported operator path (POST /admin/reissue-key), runs a bounded set of
 * customer-equivalent requests with it, then always revokes it
 * (POST /admin/revoke-keys) and proves the key is rejected afterwards.
 *
 * The key never leaves this process: it is not printed, logged or written.
 * The evidence returned (and printed by the CLI) holds statuses, ids, counts and
 * digests only. Run from the `recalls-acceptance` workflow, or by an operator:
 *
 *   ADMIN_TOKEN=… ACCEPTANCE_EXPECTED_SHA=<deployed commit> pnpm exec tsx apps/recalls-worker/scripts/acceptance.ts
 */

import { createHash, randomInt } from 'node:crypto';

/** Only internal fixtures may be used: a reissue revokes the customer's existing keys. */
export const ACCEPTANCE_CUSTOMER_PATTERN = /^cus_acceptance_internal_[0-9]{8}$/;
export const ACCEPTANCE_EMAIL_SUFFIX = '@aroqon.invalid';

export interface AcceptanceOptions {
  readonly apiOrigin: string;
  readonly publicOrigin: string;
  readonly adminToken: string;
  readonly stripeCustomerId: string;
  /** The 40-hex source commit being accepted: the live Worker version must be tagged with its first 12 characters. */
  readonly expectedSha: string;
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface AcceptanceEvidence {
  readonly ok: boolean;
  readonly started_at: string;
  readonly finished_at: string;
  readonly api_origin: string;
  readonly source_sha: string;
  readonly live_version: { readonly version_id: string | null; readonly tag: string | null; readonly timestamp: string | null };
  readonly customer: { readonly stripe_customer_id: string; readonly plan: string | null; readonly status: string | null };
  readonly key_prefix: string | null;
  readonly metered_requests: number;
  readonly checks: Check[];
  readonly revocation: { readonly revoked: boolean; readonly active_keys: number | null; readonly rejected_after: boolean };
  readonly indexnow: unknown;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A well-formed key that was never issued: exercises the hash lookup, not just the format check. */
function unissuedKey(): string {
  let body = '';
  for (let index = 0; index < 32; index += 1) body += KEY_ALPHABET[randomInt(62)];
  return `rcl_live_${body}`;
}

type Json = Record<string, unknown>;

export async function runAcceptance(options: AcceptanceOptions): Promise<AcceptanceEvidence> {
  const startedAt = new Date().toISOString();
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = ''): boolean => {
    checks.push({ name, ok, detail });
    return ok;
  };
  const call = async (origin: string, path: string, init: { method?: string; key?: string | null; admin?: boolean } = {}): Promise<{ status: number; body: Json | null; headers: Headers }> => {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'data-foundry-acceptance' };
    if (init.admin) headers['authorization'] = `Bearer ${options.adminToken}`;
    else if (init.key) headers['authorization'] = `Bearer ${init.key}`;
    const response = await options.fetch(new Request(`${origin}${path}`, { method: init.method ?? 'GET', headers }));
    const text = await response.text();
    let body: Json | null = null;
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = null;
    }
    return { status: response.status, body, headers: response.headers };
  };
  const api = options.apiOrigin;
  const errorCode = (body: Json | null): string => String((body?.['error'] as Json | undefined)?.['code'] ?? '');

  if (!ACCEPTANCE_CUSTOMER_PATTERN.test(options.stripeCustomerId)) {
    throw new Error(`Refusing ${options.stripeCustomerId}: acceptance runs only against an internal cus_acceptance_internal_YYYYMMDD customer.`);
  }

  // Evidence must describe the version that is actually serving: refuse before issuing a key otherwise.
  if (!/^[0-9a-f]{40}$/.test(options.expectedSha)) throw new Error('expectedSha must be a full 40-character commit SHA.');
  const version = await call(options.publicOrigin, '/admin/version', { admin: true });
  const liveVersion = {
    version_id: (version.body?.['version_id'] as string | null | undefined) ?? null,
    tag: (version.body?.['tag'] as string | null | undefined) ?? null,
    timestamp: (version.body?.['timestamp'] as string | null | undefined) ?? null,
  };
  if (version.status !== 200 || liveVersion.tag !== options.expectedSha.slice(0, 12)) {
    throw new Error(`Refusing: the live Worker version (${version.status}, tag ${liveVersion.tag ?? 'none'}) is not ${options.expectedSha.slice(0, 12)}. Deploy that commit first.`);
  }

  // Credential rejection before any key exists.
  for (const path of ['/v1/product-recalls?limit=1', '/v1/recalls?limit=1']) {
    const missing = await call(api, path);
    check(`missing key rejected ${path}`, missing.status === 401 && errorCode(missing.body) === 'missing_key', `${missing.status} ${errorCode(missing.body)}`);
    const invalid = await call(api, path, { key: unissuedKey() });
    check(`unissued key rejected ${path}`, invalid.status === 401 && errorCode(invalid.body) === 'invalid_key', `${invalid.status} ${errorCode(invalid.body)}`);
  }

  const indexnow = await call(options.publicOrigin, '/admin/indexnow-status', { admin: true });
  check('operator IndexNow status readable (deployed code has the per-feed watermark path)', indexnow.status === 200, String(indexnow.status));

  // Set inside the guarded block below, so a key created by a reissue whose response is lost
  // (or whose fetch throws) is still revoked by customer id in `finally`.
  let key: string | null = null;
  let reissueAttempted = false;
  const customer: { stripe_customer_id: string; plan: string | null; status: string | null } = { stripe_customer_id: options.stripeCustomerId, plan: null, status: null };
  let metered = 0;
  let revocation: AcceptanceEvidence['revocation'] = { revoked: false, active_keys: null, rejected_after: false };

  const runChecks = async (k: string): Promise<void> => {
    const metered200 = async (path: string): Promise<{ status: number; body: Json | null; headers: Headers }> => {
      metered += 1;
      return call(api, path, { key: k });
    };

    const before = await call(api, '/v1/account', { key: k });
    const usedBefore = Number(before.body?.['month_requests']);
    if (!check('key authenticates (GET /v1/account)', before.status === 200 && Number.isFinite(usedBefore), `${before.status} plan=${String(before.body?.['plan'])} status=${String(before.body?.['status'])} month_requests=${usedBefore}`)) return;

    // Product recalls: CPSC and Health Canada.
    const rows = (body: Json | null): Json[] => (Array.isArray(body?.['data']) ? (body['data'] as Json[]) : []);
    const provenanceOk = (row: Json, host: RegExp): boolean => {
      const provenance = row['provenance'] as Json | undefined;
      return typeof provenance?.['source_url'] === 'string' && host.test(new URL(provenance['source_url'] as string).host) && /^[0-9a-f]{64}$/.test(String(provenance['raw_sha256'])) && typeof provenance['parser_version'] === 'string';
    };
    const cpsc1 = await metered200('/v1/product-recalls?agency=CPSC&limit=3');
    const cpscRows = rows(cpsc1.body);
    check('CPSC search: 3 CPSC notices with provenance', cpsc1.status === 200 && cpscRows.length === 3 && cpscRows.every((row) => row['agency'] === 'CPSC' && provenanceOk(row, /(^|\.)cpsc\.gov$/)), `${cpsc1.status} ids=${cpscRows.map((row) => row['id']).join(',')}`);
    const cursor = cpsc1.body?.['next_cursor'];
    const cpsc2 = typeof cursor === 'string' ? await metered200(`/v1/product-recalls?agency=CPSC&limit=3&cursor=${encodeURIComponent(cursor)}`) : null;
    const page2 = rows(cpsc2?.body ?? null);
    const firstIds = new Set(cpscRows.map((row) => row['id']));
    check('CPSC pagination: next page is disjoint', cpsc2?.status === 200 && page2.length > 0 && page2.every((row) => !firstIds.has(row['id']) && row['agency'] === 'CPSC'), `${cpsc2?.status ?? 'no cursor'} ids=${page2.map((row) => row['id']).join(',')}`);

    const hc = await metered200('/v1/product-recalls?agency=HC&limit=3');
    const hcRows = rows(hc.body);
    check('Health Canada search: 3 HC notices with provenance', hc.status === 200 && hcRows.length === 3 && hcRows.every((row) => row['agency'] === 'HC' && provenanceOk(row, /(^|\.)canada\.ca$/)), `${hc.status} ids=${hcRows.map((row) => row['id']).join(',')}`);

    const fire = await metered200('/v1/product-recalls?agency=CPSC&hazard=fire&limit=5');
    const fireRows = rows(fire.body);
    check('filter hazard=fire: every notice carries the fire class', fire.status === 200 && fireRows.length > 0 && fireRows.every((row) => ((row['hazard'] as Json | undefined)?.['classes'] as string[] | undefined)?.includes('fire') === true), `${fire.status} n=${fireRows.length}`);

    const attributed = (body: Json | null, agency: string): boolean => {
      const sources = (body?.['attribution'] as Json | undefined)?.['sources'];
      return Array.isArray(sources) && sources.some((source) => (source as Json)['agency'] === agency);
    };
    for (const row of [cpscRows[0], hcRows[0]]) {
      if (!row) continue;
      const id = String(row['id']);
      const one = await metered200(`/v1/product-recalls/${encodeURIComponent(id)}?include=raw`);
      const data = (one.body?.['data'] ?? null) as Json | null;
      const redaction = data?.['raw_redaction'] as Json | undefined;
      const presented = data && 'raw' in data ? sha256(JSON.stringify(data['raw'])) : null;
      check(`record ${id} include=raw: provenance, source attribution and digest of the returned raw`, one.status === 200 && data?.['id'] === id && presented !== null && presented === redaction?.['presented_sha256'] && attributed(one.body, String(row['agency'])), `${one.status} presented_sha256_match=${presented === redaction?.['presented_sha256']} removed=${JSON.stringify(redaction?.['removed_fields'] ?? [])}`);
    }

    const withCode = [...cpscRows, ...page2, ...fireRows].find((row) => {
      const identifiers = row['identifiers'] as Json | undefined;
      return ((identifiers?.['gtins'] as string[] | undefined)?.length ?? 0) > 0 || ((identifiers?.['model_numbers'] as string[] | undefined)?.length ?? 0) > 0;
    });
    if (withCode) {
      const identifiers = withCode['identifiers'] as { gtins: string[]; model_numbers: string[] };
      const code = identifiers.gtins[0] ?? identifiers.model_numbers[0] ?? '';
      const lookup = await metered200(`/v1/product-recalls/lookup?code=${encodeURIComponent(code)}`);
      const found = rows(lookup.body).some((match) => (match['recall'] as Json | undefined)?.['id'] === withCode['id']);
      check('product code lookup returns the notice that lists the code', lookup.status === 200 && found, `${lookup.status} code_kind=${identifiers.gtins[0] ? 'gtin' : 'model'} id=${String(withCode['id'])}`);
    } else {
      check('product code lookup returns the notice that lists the code', false, 'no sampled notice carried a GTIN or model number');
    }

    const unknown = await metered200('/v1/product-recalls/cpsc-00000');
    check('unknown notice id: 404', unknown.status === 404, String(unknown.status));

    // FDA regression.
    const fda = await metered200('/v1/recalls?category=food&limit=2');
    const fdaRows = rows(fda.body);
    check('FDA search: food recalls with provenance', fda.status === 200 && fdaRows.length === 2 && fdaRows.every((row) => row['category'] === 'food' && typeof (row['provenance'] as Json | undefined)?.['raw_sha256'] === 'string'), `${fda.status} ids=${fdaRows.map((row) => row['recall_number']).join(',')}`);
    const fdaCoded = fdaRows.find((row) => Object.values((row['codes'] as Record<string, string[]> | undefined) ?? {}).some((list) => list.length > 0));
    if (fdaCoded) {
      const codes = fdaCoded['codes'] as Record<string, string[]>;
      const [kind, list] = Object.entries(codes).find(([, values]) => values.length > 0) as [string, string[]];
      const lookup = await metered200(`/v1/recalls/lookup?code=${encodeURIComponent(list[0] as string)}`);
      const found = rows(lookup.body).some((match) => (match['recall'] as Json | undefined)?.['recall_number'] === fdaCoded['recall_number']);
      check('FDA code lookup returns the recall that lists the code', lookup.status === 200 && found, `${lookup.status} code_kind=${kind} recall=${String(fdaCoded['recall_number'])}`);
    } else {
      check('FDA code lookup returns the recall that lists the code', false, 'no sampled FDA recall carried an extracted code');
    }
    if (fdaRows[0]) {
      const number = String(fdaRows[0]['recall_number']);
      const one = await metered200(`/v1/recalls/${encodeURIComponent(number)}?include=raw`);
      check(`FDA record ${number} include=raw`, one.status === 200 && ((one.body?.['data'] as Json | undefined)?.['recall_number'] === number) && 'raw' in ((one.body?.['data'] as Json | undefined) ?? {}), String(one.status));
    }

    const after = await call(api, '/v1/account', { key: k });
    const usedAfter = Number(after.body?.['month_requests']);
    check('metering: each data request counted once, account reads not counted', after.status === 200 && usedAfter - usedBefore === metered, `delta=${usedAfter - usedBefore} metered=${metered} allowance=${String(after.body?.['month_allowance'])}`);
  };

  try {
    reissueAttempted = true;
    const issued = await call(options.publicOrigin, `/admin/reissue-key?stripe_customer_id=${encodeURIComponent(options.stripeCustomerId)}`, { method: 'POST', admin: true });
    key = typeof issued.body?.['api_key'] === 'string' ? (issued.body['api_key'] as string) : null;
    const email = String(issued.body?.['email'] ?? '');
    customer.plan = (issued.body?.['plan'] as string | undefined) ?? null;
    customer.status = (issued.body?.['status'] as string | undefined) ?? null;
    const issuedOk = check('operator reissue returned a key for the internal customer', issued.status === 200 && key !== null && email.endsWith(ACCEPTANCE_EMAIL_SUFFIX), `${issued.status} plan=${customer.plan} status=${customer.status}`);
    // A key for an inactive fixture authenticates to 403 on every endpoint: say so instead of failing obscurely.
    const activeOk = issuedOk && check('acceptance fixture is active', customer.status === 'active', customer.status === 'active' ? 'active' : `status=${customer.status}: reactivate the fixture (docs/owner-actions/recalls-operations.md, "Production acceptance")`);
    if (activeOk) {
      await runChecks(key as string);
      // The whole run must have been served by the version the evidence names.
      const again = await call(options.publicOrigin, '/admin/version', { admin: true });
      check('live version unchanged for the whole run', again.status === 200 && again.body?.['version_id'] === liveVersion.version_id && again.body?.['tag'] === liveVersion.tag, `${again.status} version=${String(again.body?.['version_id'])}`);
    }
  } finally {
    // Always revoke once a reissue was attempted, by customer id, whether or not a key came back
    // and whatever happened above, including a thrown error.
    if (reissueAttempted) {
      const revoked = await call(options.publicOrigin, `/admin/revoke-keys?stripe_customer_id=${encodeURIComponent(options.stripeCustomerId)}`, { method: 'POST', admin: true });
      const activeKeys = typeof revoked.body?.['active_keys'] === 'number' ? (revoked.body['active_keys'] as number) : null;
      if (key) {
        const rejected = await call(api, '/v1/account', { key });
        const rejectedData = await call(api, '/v1/product-recalls?limit=1', { key });
        revocation = { revoked: revoked.status === 200, active_keys: activeKeys, rejected_after: rejected.status === 401 && rejectedData.status === 401 && errorCode(rejectedData.body) === 'invalid_key' };
        check('temporary key revoked and rejected afterwards', revocation.revoked && revocation.active_keys === 0 && revocation.rejected_after, `revoke=${revoked.status} active_keys=${revocation.active_keys} after=${rejected.status}/${rejectedData.status}`);
      } else {
        revocation = { revoked: revoked.status === 200, active_keys: activeKeys, rejected_after: false };
        check('no key left active after a reissue that returned none', revocation.revoked && activeKeys === 0, `revoke=${revoked.status} active_keys=${activeKeys}`);
      }
    }
  }

  return {
    ok: checks.every((item) => item.ok) && key !== null && revocation.revoked && revocation.rejected_after,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    api_origin: api,
    source_sha: options.expectedSha,
    live_version: liveVersion,
    customer,
    key_prefix: key ? key.slice(0, 'rcl_live_'.length + 4) : null,
    metered_requests: metered,
    checks,
    revocation,
    indexnow: indexnow.body,
  };
}

async function main(): Promise<void> {
  const adminToken = process.env['ADMIN_TOKEN'] ?? '';
  if (adminToken.length < 32) throw new Error('ADMIN_TOKEN is not set (it is never printed).');
  const evidence = await runAcceptance({
    apiOrigin: process.env['API_ORIGIN'] ?? 'https://api.data.aroqon.com',
    publicOrigin: process.env['PUBLIC_ORIGIN'] ?? 'https://data.aroqon.com',
    adminToken,
    stripeCustomerId: process.env['ACCEPTANCE_STRIPE_CUSTOMER_ID'] ?? 'cus_acceptance_internal_20260928',
    expectedSha: process.env['ACCEPTANCE_EXPECTED_SHA'] ?? '',
    fetch: (request) => fetch(request),
  });
  const serialized = JSON.stringify(evidence, null, 2);
  if (process.env['ACCEPTANCE_EVIDENCE_FILE']) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.env['ACCEPTANCE_EVIDENCE_FILE'], serialized);
  }
  console.log(serialized);
  if (!evidence.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
