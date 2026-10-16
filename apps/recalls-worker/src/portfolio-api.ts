/** Portfolio interfaces over the existing canonical queries and publication gates. */
import { BadRequest, lookupCandidates, lookupCode } from './api.js';
import { DATASETS, publishedDatasets, type DatasetKey } from './catalog.js';
import type { Env } from './env.js';
import { extractedServed } from './intake.js';
import type { PageContext } from './pages.js';
import { lookupProductCode, productLookupCandidates } from './product-api.js';

export interface LookupQuery {
  readonly code: string;
  readonly datasets: readonly DatasetKey[];
  readonly includeRaw: boolean;
}

export const LOOKUP_COVERAGE_NOTE = 'An empty result means no exact indexed identifier matched in the requested datasets; it does not prove that a product is safe or has never been recalled. Source notices and extracted identifiers can be incomplete. Notices remain separate; matches are not entity merges.';

export function parseLookupQuery(params: URLSearchParams): LookupQuery {
  for (const key of params.keys()) {
    if (!['code', 'datasets', 'include'].includes(key)) throw new BadRequest(`Unknown parameter: ${key}`);
    if (params.getAll(key).length !== 1) throw new BadRequest(`${key} must occur once`);
  }
  const code = (params.get('code') ?? '').trim();
  lookupCandidates(code);
  const names = params.has('datasets') ? params.get('datasets')!.split(',').map((value) => value.trim()) : Object.keys(DATASETS);
  if (names.length === 0 || names.some((name) => !Object.hasOwn(DATASETS, name)) || new Set(names).size !== names.length) {
    throw new BadRequest(`datasets must be a comma-separated selection of: ${Object.keys(DATASETS).join(', ')}, without duplicates`);
  }
  const datasets = names as DatasetKey[];
  if (datasets.includes('product-recalls')) productLookupCandidates(code);
  const include = params.get('include');
  if (include !== null && include !== 'raw') throw new BadRequest('include must be raw when supplied');
  if (include === 'raw' && datasets.length !== 1) throw new BadRequest('include=raw requires exactly one explicit dataset, e.g. datasets=recalls or datasets=product-recalls');
  return { code, datasets, includeRaw: include === 'raw' };
}

export async function lookupAcrossDatasets(env: Env, query: LookupQuery, channel: 'direct' | 'rapidapi'): Promise<Record<string, unknown>> {
  // Raw evidence is admitted for one dataset only; do not retain two raw response envelopes.
  const results: Array<Record<string, unknown>> = [];
  for (const dataset of query.datasets) {
    const payload = dataset === 'recalls'
      ? await lookupCode(env.DB, env.RAW_ARTIFACTS, query.code, query.includeRaw)
      : await lookupProductCode(env.DB, env.RAW_ARTIFACTS, query.code, query.includeRaw, extractedServed(env, channel));
    results.push({ dataset, ...payload });
  }
  return { code: query.code, results, truncated: results.some((result) => result['truncated'] === true), coverage_note: LOOKUP_COVERAGE_NOTE };
}

/** No database query: current availability comes from the same catalog as the site. */
export function datasetCatalog(env: Env, ctx: PageContext): Record<string, unknown> {
  return {
    data: publishedDatasets(env).map((entry) => ({
      id: entry.key,
      registry: entry.registry,
      name: entry.name,
      summary: entry.summary,
      domain: entry.domain,
      record_type: entry.recordType,
      region: entry.region,
      documentation_url: `${ctx.publicOrigin}/docs${entry.docsAnchor}`,
      stats_url: `${ctx.apiOrigin}${entry.statsPath}`,
      endpoints: entry.endpoints.map(({ method, path, summary }) => ({ method, path, summary })),
      fields: entry.fields,
      sources: entry.sources,
      attribution: entry.attribution,
      limitations: entry.limitations,
      refresh_schedule: entry.refreshSchedule,
    })),
    openapi_url: `${ctx.apiOrigin}/openapi.json`,
  };
}
