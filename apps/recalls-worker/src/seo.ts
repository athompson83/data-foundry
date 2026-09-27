/**
 * Discoverability for search engines and LLM crawlers: one public page per
 * recall, navigation hubs, a sitemap index, schema.org JSON-LD, llms.txt and
 * IndexNow pings. Everything here reads the same D1 rows the API serves
 * (AGENTS.md rule 5), and nothing here exposes a field the API does not.
 */

import { RECALL_NUMBER_SOURCE } from '@data-foundry/recall-structuring';

import type { D1Database, R2Bucket } from './env.js';
import { escapeHtml, layout, type PageContext } from './pages.js';

/** Routes use the ingestion grammar, so every published recall has a page and an API URL. */
export const RECALL_NUMBER_SEGMENT = RECALL_NUMBER_SOURCE;
export const RECALL_PAGE_PATTERN = new RegExp(`^/recalls/(${RECALL_NUMBER_SEGMENT})$`);
export const RECALL_API_PATTERN = new RegExp(`^/v1/recalls/(${RECALL_NUMBER_SEGMENT})$`);
const ROUTABLE = new RegExp(`^${RECALL_NUMBER_SEGMENT}$`);
export function isRoutableRecallNumber(value: string): boolean {
  return ROUTABLE.test(value);
}
export const BROWSE_PATTERN = /^\/recalls\/browse\/(food|drug|device)\/(\d{4})$/;
export const SITEMAP_PATTERN = /^\/sitemaps\/recalls-([1-9]\d{0,2})\.xml$/;
/** Well under the protocol's 50,000-URL and 50 MB limits. */
export const SITEMAP_PAGE_SIZE = 20_000;
export const BROWSE_PAGE_SIZE = 200;
/** openFDA enforcement reports start in 2012; no category/year has more than a few thousand. */
export const FIRST_BROWSE_YEAR = 2012;

/** Whether a browse hub can exist at all, before any D1 read: a real year and a page number with rows behind it. */
export function browseInRange(year: string, page: number, total: number): boolean {
  const y = Number(year);
  return y >= FIRST_BROWSE_YEAR && y <= new Date().getUTCFullYear() && page >= 1 && (page - 1) * BROWSE_PAGE_SIZE < total;
}

export async function browseCount(db: D1Database, category: string, year: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM recall WHERE category = ? AND reported_on >= ? AND reported_on < ?')
    .bind(category, `${year}-01-01`, `${Number(year) + 1}-01-01`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
/** Rule 8 (no thin pages): index a recall page only when FDA gave both a product and a reason. */
export const MIN_INDEXABLE_TEXT = 20;

const CATEGORY_LABEL: Readonly<Record<string, string>> = { food: 'Food', drug: 'Drug', device: 'Medical device' };
const INDEXABLE_SQL = `length(coalesce(product_description, '')) >= ${MIN_INDEXABLE_TEXT} AND length(coalesce(reason_for_recall, '')) >= ${MIN_INDEXABLE_TEXT}`;

export interface PresentedRecall {
  readonly recall_number: string;
  readonly category: string;
  readonly classification: string | null;
  readonly status: string | null;
  readonly voluntary: boolean | null;
  readonly event_id: string | null;
  readonly firm: { readonly name: string | null; readonly city: string | null; readonly state: string | null; readonly country: string | null };
  readonly dates: { readonly initiated: string | null; readonly classified: string | null; readonly reported: string | null; readonly terminated: string | null };
  readonly product_description: string | null;
  readonly reason_for_recall: string | null;
  readonly distribution: { readonly nationwide_us: boolean; readonly international: boolean; readonly us_states: readonly string[]; readonly countries: readonly string[] };
  readonly quantity: { readonly total: number | null; readonly unit: string | null };
  readonly codes: {
    readonly gtins: readonly string[];
    readonly ndcs: readonly string[];
    readonly lots: readonly string[];
    readonly serial_numbers: readonly string[];
    readonly model_numbers: readonly string[];
    readonly expiration_dates: readonly string[];
  };
  readonly reason: { readonly classes: readonly string[]; readonly allergens: readonly string[]; readonly pathogens: readonly string[] };
  readonly provenance: { readonly source_url: string; readonly parser_version: string; readonly changed_at: string };
}

export function isIndexable(recall: Pick<PresentedRecall, 'product_description' | 'reason_for_recall'>): boolean {
  return (recall.product_description?.length ?? 0) >= MIN_INDEXABLE_TEXT && (recall.reason_for_recall?.length ?? 0) >= MIN_INDEXABLE_TEXT;
}

/** A short product name for titles: the description up to its first clause, trimmed to a word boundary. */
export function productName(description: string | null): string {
  const text = (description ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Product';
  const clause = text.split(/[;,.(]|\s-\s|\s–\s/)[0]?.trim() || text;
  if (clause.length <= 70) return clause;
  const cut = clause.slice(0, 70);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 70)}…`;
}

function humanList(values: readonly string[], limit: number): string {
  const shown = values.slice(0, limit).map((value) => `<code>${escapeHtml(value)}</code>`).join(', ');
  return values.length > limit ? `${shown} and ${values.length - limit} more` : shown;
}

function label(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ');
}

export function organization(ctx: PageContext): Record<string, unknown> {
  return { '@type': 'Organization', '@id': `${ctx.publicOrigin}/#org`, name: 'Data Foundry by Aroqon Data', url: `${ctx.publicOrigin}/`, email: ctx.supportEmail };
}

export function recallsDataset(ctx: PageContext): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': `${ctx.publicOrigin}/recalls#dataset`,
    name: 'FDA Recall Intelligence',
    description:
      'Every FDA food, drug and medical-device enforcement report published on openFDA since June 2012, with distribution states and countries, lot and serial numbers, UPC/GTIN/UDI, NDC, expiry dates, recall-reason classes, allergens and pathogens extracted from the free text, and source provenance on every record.',
    url: `${ctx.publicOrigin}/recalls`,
    keywords: ['FDA recalls', 'food recalls', 'drug recalls', 'medical device recalls', 'UPC recall lookup', 'NDC recall lookup', 'lot number recall', 'recall API'],
    creator: organization(ctx),
    publisher: organization(ctx),
    isBasedOn: 'https://open.fda.gov/apis/food/enforcement/',
    temporalCoverage: '2012-06-20/..',
    spatialCoverage: { '@type': 'Place', name: 'United States' },
    isAccessibleForFree: false,
    license: `${ctx.publicOrigin}/terms`,
    variableMeasured: ['recall classification', 'recall status', 'distribution states', 'GTIN', 'NDC', 'lot number', 'expiration date', 'recall reason class', 'allergen', 'pathogen'],
    distribution: [{ '@type': 'DataDownload', name: 'Recall API (JSON)', encodingFormat: 'application/json', contentUrl: `${ctx.apiOrigin}/v1/recalls` }],
    documentation: `${ctx.publicOrigin}/recalls/docs`,
  };
}

export function catalogJsonLd(ctx: PageContext): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@type': 'DataCatalog', name: 'Data Foundry', url: `${ctx.publicOrigin}/`, publisher: organization(ctx), dataset: [recallsDataset(ctx)] };
}

export function recallTitle(recall: PresentedRecall): string {
  const classText = recall.classification ? `Class ${recall.classification} ` : '';
  return `${productName(recall.product_description)} — ${classText}${CATEGORY_LABEL[recall.category]?.toLowerCase() ?? ''} recall ${recall.recall_number}`;
}

export function recallDescription(recall: PresentedRecall): string {
  const firm = recall.firm.name ? ` by ${recall.firm.name}` : '';
  const where = recall.distribution.nationwide_us ? 'nationwide' : recall.distribution.us_states.length ? `in ${recall.distribution.us_states.slice(0, 8).join(', ')}${recall.distribution.us_states.length > 8 ? '…' : ''}` : '';
  const reason = (recall.reason_for_recall ?? '').replace(/\s+/g, ' ').slice(0, 110);
  return `${recall.status ?? 'FDA'} recall${firm}${recall.dates.reported ? `, reported ${recall.dates.reported}` : ''}${where ? `, distributed ${where}` : ''}. ${reason}`.slice(0, 300);
}

export function recallPage(ctx: PageContext, recall: PresentedRecall): string {
  const path = `/recalls/${recall.recall_number}`;
  const rows: Array<[string, string]> = [];
  const add = (name: string, value: string | null | undefined) => {
    if (value) rows.push([name, value]);
  };
  add('Recall number', `<code>${escapeHtml(recall.recall_number)}</code>`);
  add('Product type', escapeHtml(CATEGORY_LABEL[recall.category] ?? recall.category));
  add('Classification', recall.classification ? `Class ${escapeHtml(recall.classification)}` : null);
  add('Status', recall.status ? escapeHtml(recall.status) : null);
  add('Voluntary or mandated', recall.voluntary === null ? null : recall.voluntary ? 'Voluntary' : 'FDA mandated');
  add('Recalling firm', recall.firm.name ? escapeHtml([recall.firm.name, recall.firm.city, recall.firm.state, recall.firm.country].filter(Boolean).join(', ')) : null);
  add('Recall initiated', recall.dates.initiated);
  add('Classified', recall.dates.classified);
  add('Reported by FDA', recall.dates.reported);
  add('Terminated', recall.dates.terminated);
  add('Distributed', recall.distribution.nationwide_us ? 'Nationwide (US)' : recall.distribution.us_states.length ? escapeHtml(recall.distribution.us_states.join(', ')) : null);
  add('Countries outside the US', recall.distribution.countries.length ? escapeHtml(recall.distribution.countries.join(', ')) : null);
  add('Quantity', recall.quantity.total !== null ? escapeHtml(`${recall.quantity.total.toLocaleString('en-US')}${recall.quantity.unit ? ` ${recall.quantity.unit}` : ''}`) : null);
  add('Reason classes', recall.reason.classes.length ? escapeHtml(recall.reason.classes.map(label).join(', ')) : null);
  add('Allergens', recall.reason.allergens.length ? escapeHtml(recall.reason.allergens.map(label).join(', ')) : null);
  add('Pathogens', recall.reason.pathogens.length ? escapeHtml(recall.reason.pathogens.map(label).join(', ')) : null);
  add('UPC / GTIN / UDI-DI', recall.codes.gtins.length ? humanList(recall.codes.gtins, 25) : null);
  add('NDC', recall.codes.ndcs.length ? humanList(recall.codes.ndcs, 25) : null);
  add('Lot numbers', recall.codes.lots.length ? humanList(recall.codes.lots, 40) : null);
  add('Serial numbers', recall.codes.serial_numbers.length ? humanList(recall.codes.serial_numbers, 25) : null);
  add('Model numbers', recall.codes.model_numbers.length ? humanList(recall.codes.model_numbers, 25) : null);
  add('Expiration dates', recall.codes.expiration_dates.length ? humanList(recall.codes.expiration_dates, 25) : null);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${ctx.publicOrigin}${path}`,
    url: `${ctx.publicOrigin}${path}`,
    name: recallTitle(recall),
    description: recallDescription(recall),
    dateModified: recall.provenance.changed_at,
    ...(recall.dates.reported ? { datePublished: recall.dates.reported } : {}),
    isPartOf: { '@id': `${ctx.publicOrigin}/recalls#dataset` },
    publisher: organization(ctx),
    isBasedOn: recall.provenance.source_url,
    about: {
      '@type': 'Product',
      name: productName(recall.product_description),
      description: recall.product_description ?? undefined,
      ...(recall.codes.gtins.length ? { gtin: recall.codes.gtins[0] } : {}),
      ...(recall.codes.model_numbers.length ? { model: recall.codes.model_numbers[0] } : {}),
    },
    ...(recall.firm.name ? { mentions: { '@type': 'Organization', name: recall.firm.name } } : {}),
  };
  const api = `${ctx.apiOrigin}/v1/recalls/${recall.recall_number}`;
  const body = `<p class="small muted"><a href="/recalls/browse/${escapeHtml(recall.category)}/${escapeHtml((recall.dates.reported ?? '').slice(0, 4) || 'all')}">${escapeHtml(CATEGORY_LABEL[recall.category] ?? '')} recalls ${escapeHtml((recall.dates.reported ?? '').slice(0, 4))}</a></p>
<h1>${escapeHtml(recallTitle(recall))}</h1>
<p class="lede">${escapeHtml(recallDescription(recall))}</p>
<div class="table-wrap"><table>${rows.map(([name, value]) => `<tr><th scope="row">${name}</th><td>${value}</td></tr>`).join('')}</table></div>
<h2>Product</h2><p>${escapeHtml(recall.product_description ?? 'Not stated by FDA.')}</p>
<h2>Reason for recall</h2><p>${escapeHtml(recall.reason_for_recall ?? 'Not stated by FDA.')}</p>
<h2>Machine access</h2>
<p class="muted">This record, with every extracted code, the verbatim FDA record and provenance, is available from the recall API: <code>GET ${escapeHtml(api)}</code>. Look up any UPC, UDI, NDC or lot with <code>/v1/recalls/lookup?code=…</code>. <a href="/recalls/docs">API docs</a> · <a href="/recalls#pricing">free and paid keys</a>.</p>
<p class="small muted">Source: U.S. Food and Drug Administration enforcement report via <a href="${escapeHtml(recall.provenance.source_url)}">openFDA</a> (CC0). Structured by Data Foundry (${escapeHtml(recall.provenance.parser_version)}); last changed ${escapeHtml(recall.provenance.changed_at.slice(0, 10))}. Not affiliated with or endorsed by FDA. Not medical or legal advice.</p>`;
  return layout(ctx, recallTitle(recall), recallDescription(recall), body, { path, jsonLd: [jsonLd], ...(isIndexable(recall) ? {} : { robots: 'noindex, follow' }) });
}

export async function browseIndex(ctx: PageContext, db: D1Database): Promise<string> {
  const rows = await db
    .prepare("SELECT category, substr(reported_on, 1, 4) AS year, COUNT(*) AS n FROM recall WHERE reported_on IS NOT NULL GROUP BY category, year ORDER BY category, year DESC")
    .all<{ category: string; year: string; n: number }>();
  const byCategory = new Map<string, Array<{ year: string; n: number }>>();
  for (const row of rows.results) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), { year: row.year, n: row.n }]);
  const sections = [...byCategory]
    .map(([category, years]) => `<h2>${escapeHtml(CATEGORY_LABEL[category] ?? category)} recalls</h2><p>${years.map((y) => `<a href="/recalls/browse/${escapeHtml(category)}/${escapeHtml(y.year)}">${escapeHtml(y.year)}</a> <span class="muted small">(${y.n.toLocaleString('en-US')})</span>`).join(' · ')}</p>`)
    .join('');
  return layout(ctx, 'Browse FDA recalls by year — Data Foundry', 'Every FDA food, drug and medical device recall since 2012, by product type and year.', `<h1>Browse FDA recalls</h1><p class="lede">Every FDA enforcement report since June 2012, one page per recall, with the codes, distribution and reasons structured.</p>${sections}`, {
    path: '/recalls/browse',
    robots: 'noindex, follow',
  });
}

export async function browsePage(ctx: PageContext, db: D1Database, category: string, year: string, page: number): Promise<string | null> {
  const offset = (page - 1) * BROWSE_PAGE_SIZE;
  const rows = await db
    .prepare('SELECT recall_number, classification, reported_on, firm_name, product_description FROM recall WHERE category = ? AND reported_on >= ? AND reported_on < ? ORDER BY reported_on DESC, recall_number LIMIT ? OFFSET ?')
    .bind(category, `${year}-01-01`, `${Number(year) + 1}-01-01`, BROWSE_PAGE_SIZE + 1, offset)
    .all<{ recall_number: string; classification: string | null; reported_on: string; firm_name: string | null; product_description: string | null }>();
  if (rows.results.length === 0) return null;
  const items = rows.results.slice(0, BROWSE_PAGE_SIZE);
  const base = `/recalls/browse/${category}/${year}`;
  const nav = [page > 1 ? `<a href="${base}${page === 2 ? '' : `?page=${page - 1}`}">← Newer</a>` : '', rows.results.length > BROWSE_PAGE_SIZE ? `<a href="${base}?page=${page + 1}">Older →</a>` : ''].filter(Boolean).join(' · ');
  const list = items
    .filter((row) => isRoutableRecallNumber(row.recall_number))
    .map((row) => `<tr><td>${escapeHtml(row.reported_on)}</td><td><a href="/recalls/${escapeHtml(row.recall_number)}">${escapeHtml(row.recall_number)}</a></td><td>${row.classification ? `Class ${escapeHtml(row.classification)}` : ''}</td><td>${escapeHtml(productName(row.product_description))}</td><td>${escapeHtml(row.firm_name ?? '')}</td></tr>`)
    .join('');
  const name = `${CATEGORY_LABEL[category] ?? category} recalls reported in ${year}`;
  return layout(ctx, `${name}${page > 1 ? ` (page ${page})` : ''} — Data Foundry`, `${name}: FDA enforcement reports with structured codes, distribution and reasons.`, `<p class="small muted"><a href="/recalls/browse">All years</a></p><h1>${escapeHtml(name)}</h1><p>${nav}</p><div class="table-wrap"><table><tr><th>Reported</th><th>Recall</th><th>Class</th><th>Product</th><th>Firm</th></tr>${list}</table></div><p>${nav}</p>`, {
    path: `${base}${page > 1 ? `?page=${page}` : ''}`,
    robots: 'noindex, follow',
  });
}

const STATIC_PATHS = ['/', '/recalls', '/recalls/docs', '/terms', '/privacy'];

export async function sitemapIndex(ctx: PageContext, db: D1Database): Promise<string> {
  const row = await db.prepare(`SELECT COUNT(*) AS n, MAX(changed_at) AS last FROM recall WHERE ${INDEXABLE_SQL}`).first<{ n: number; last: string | null }>();
  const pages = Math.ceil((row?.n ?? 0) / SITEMAP_PAGE_SIZE);
  const entries = [`<sitemap><loc>${ctx.publicOrigin}/sitemaps/pages.xml</loc></sitemap>`];
  for (let index = 1; index <= pages; index += 1) entries.push(`<sitemap><loc>${ctx.publicOrigin}/sitemaps/recalls-${index}.xml</loc>${row?.last ? `<lastmod>${row.last.slice(0, 10)}</lastmod>` : ''}</sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</sitemapindex>`;
}

export function pagesSitemap(ctx: PageContext): string {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${STATIC_PATHS.map((path) => `<url><loc>${ctx.publicOrigin}${path}</loc></url>`).join('')}</urlset>`;
}

/** Stable order by recall number, so a URL stays in the same sitemap file between syncs. */
export async function recallSitemap(ctx: PageContext, db: D1Database, page: number): Promise<string | null> {
  const rows = await db
    .prepare(`SELECT recall_number, changed_at FROM recall WHERE ${INDEXABLE_SQL} ORDER BY recall_number LIMIT ? OFFSET ?`)
    .bind(SITEMAP_PAGE_SIZE, (page - 1) * SITEMAP_PAGE_SIZE)
    .all<{ recall_number: string; changed_at: string }>();
  if (rows.results.length === 0) return null;
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.results
    .filter((row) => isRoutableRecallNumber(row.recall_number))
    .map((row) => `<url><loc>${ctx.publicOrigin}/recalls/${encodeURIComponent(row.recall_number)}</loc><lastmod>${row.changed_at.slice(0, 10)}</lastmod></url>`)
    .join('')}</urlset>`;
}

export function robotsTxt(ctx: PageContext): string {
  // Search and AI crawlers are welcome on public pages: being cited by
  // answer engines is how agents and developers find the API. Content-Signal
  // follows https://contentsignals.org/.
  return `# Data Foundry — machine-readable summary: ${ctx.publicOrigin}/llms.txt
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /
Disallow: /recalls/welcome
Disallow: /recalls/checkout
Disallow: /admin/

Sitemap: ${ctx.publicOrigin}/sitemap.xml
`;
}

export function llmsTxt(ctx: PageContext): string {
  return `# Data Foundry

> Data Foundry turns lawfully sourced, unstructured public records into clean, current, provenance-linked data for software and AI agents, served over a JSON API. Its first dataset, FDA Recall Intelligence, structures every FDA food, drug and medical-device recall since June 2012 (about 87,000) — distribution states, lot and serial numbers, UPC/GTIN/UDI, NDC, expiry dates, reason classes, allergens and pathogens — and answers "is this product recalled, and where?" from a single code.

Key facts for agents:
- Look up one scanned or typed code (UPC, EAN, GTIN, UDI-DI, NDC or lot): \`GET ${ctx.apiOrigin}/v1/recalls/lookup?code=<code>\` with \`Authorization: Bearer <key>\`.
- Search with filters (state, category, classification, status, reason_class, allergen, dates, text): \`GET ${ctx.apiOrigin}/v1/recalls?...\`.
- One recall: \`GET ${ctx.apiOrigin}/v1/recalls/<recall_number>\`; public page: \`${ctx.publicOrigin}/recalls/<recall_number>\`.
- Live coverage and freshness, no key needed: \`GET ${ctx.apiOrigin}/v1/recalls/stats\`.
- Keys: a free Evaluate plan and paid monthly plans at ${ctx.publicOrigin}/recalls#pricing. The source is refreshed from openFDA every six hours.
- Every record carries its FDA source URL, parser version and the SHA-256 of the verbatim FDA record. Cite the recall number and ${ctx.publicOrigin}/recalls/<recall_number>.
- Data: U.S. FDA via openFDA (CC0). Not affiliated with or endorsed by FDA. Not medical or legal advice.

## Docs

- [Recall API documentation](${ctx.publicOrigin}/recalls/docs): parameters, identifiers, response shape, errors.
- [OpenAPI 3.1 description](${ctx.apiOrigin}/openapi.json): machine-readable contract for tool use.
- [Full LLM reference](${ctx.publicOrigin}/llms-full.txt): this file plus the complete parameter reference.

## Datasets

- [FDA Recall Intelligence](${ctx.publicOrigin}/recalls): food, drug and device recalls with structured codes and geography.
- [Browse recalls by year](${ctx.publicOrigin}/recalls/browse): one public page per recall.

## Optional

- [Terms](${ctx.publicOrigin}/terms)
- [Privacy](${ctx.publicOrigin}/privacy)
- Support: ${ctx.supportEmail}
`;
}

export function llmsFullTxt(ctx: PageContext): string {
  return `${llmsTxt(ctx)}
## Recall API reference

Base URL: ${ctx.apiOrigin}. Authentication: \`Authorization: Bearer rcl_live_…\` (or \`x-api-key\`). Responses are JSON.

### GET /v1/recalls/lookup?code=<code>

Interprets one code every exact way it can (GTIN-14 from any UPC/EAN/GTIN/UDI-DI with a valid check digit; NDC package or product; lot; serial; model) and returns every recall that names it, with \`interpreted_as\` listing the interpretations tried. Optional \`include=raw\` adds the verbatim FDA record.

### GET /v1/recalls

Filters (all optional, combined with AND): \`gtin\`, \`ndc\`, \`lot\`, \`serial\`, \`model\`, \`state\` (USPS code; nationwide recalls always match), \`country\` (ISO 3166-1 alpha-2), \`category\` (food|drug|device), \`classification\` (I|II|III), \`status\` (Ongoing|Completed|Terminated|Pending), \`reason_class\`, \`allergen\`, \`pathogen\`, \`firm\`, \`q\` (full-text), \`reported_from\`, \`reported_to\` (YYYY-MM-DD), \`limit\` (≤100), \`cursor\`.

Reason classes: UNDECLARED_ALLERGEN, MICROBIAL_CONTAMINATION, FOREIGN_MATERIAL, CHEMICAL_CONTAMINATION, LABELING, POTENCY, STERILITY, CGMP, SPECIFICATION_FAILURE, PACKAGING, TEMPERATURE_CONTROL, DEVICE_MALFUNCTION, SOFTWARE, UNAPPROVED_PRODUCT.
Allergens: milk, egg, fish, crustacean_shellfish, tree_nuts, peanut, wheat, soy, sesame.

### GET /v1/recalls/<recall_number>

One recall. Fields: recall_number, category, event_id, classification, status, voluntary, firm{name, city, state, postal_code, country}, dates{initiated, classified, reported, terminated}, product_description, reason_for_recall, distribution{nationwide_us, international, us_states[], countries[], us_military, internet_sales}, quantity{items[], total, unit}, codes{gtins[], ndcs[], lots[], serial_numbers[], model_numbers[], expiration_dates[]}, reason{classes[], allergens[], pathogens[]}, provenance{source, source_url, parser_version, derived_fields, raw_sha256, raw_evidence, first_seen_at, last_seen_at, changed_at}.

### GET /v1/recalls/stats (no key)

Record counts and latest FDA report date per category, distinct identifier counts, and the last successful sync time.

### Errors and limits

401 missing_key / invalid_key; 403 subscription_inactive; 429 allowance_exhausted (monthly allowance; never an overage bill); 400 invalid_request; 503 dataset_unavailable. Rate-limit headers: x-ratelimit-limit, x-ratelimit-remaining.
`;
}

/**
 * IndexNow (Bing, Yandex, Seznam, Naver; Bing's index also feeds Copilot and
 * ChatGPT search): tell engines which recall pages changed so they recrawl
 * within hours instead of weeks. The key is public by design: it is served at
 * /<key>.txt to prove host ownership.
 */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_BATCH = 10_000;

export function indexNowBodies(ctx: PageContext, key: string, recallNumbers: readonly string[]): string[] {
  const host = new URL(ctx.publicOrigin).host;
  const bodies: string[] = [];
  for (let index = 0; index < recallNumbers.length; index += INDEXNOW_BATCH) {
    const urlList = recallNumbers.slice(index, index + INDEXNOW_BATCH).map((number) => `${ctx.publicOrigin}/recalls/${encodeURIComponent(number)}`);
    bodies.push(JSON.stringify({ host, key, keyLocation: `${ctx.publicOrigin}/${key}.txt`, urlList }));
  }
  return bodies;
}

/** How long the Worker's edge cache keeps a D1-backed page (per Cloudflare data centre). */
export const EDGE_TTL_SECONDS = 3600;
/**
 * IndexNow announces a changed page only once every edge copy of its old
 * version has expired, so a crawler that follows the ping sees the new page.
 * Deleting the cache entry is not enough: the Cache API is per data centre.
 */
export const INDEXNOW_SETTLE_MS = (EDGE_TTL_SECONDS + 300) * 1000;

/** Where the last fully accepted IndexNow submission is recorded (a small JSON object in the artifact bucket). */
export const INDEXNOW_WATERMARK_KEY = 'state/indexnow-watermark.json';

/**
 * Ping IndexNow with the indexable recall pages changed since the last fully
 * accepted submission, up to one edge-cache lifetime before `started`. The
 * watermark only moves forward when every batch is accepted, so a 429 or 5xx is retried
 * on the next scheduled run instead of skipping those pages. Never throws:
 * discovery must not fail a sync.
 */
export async function pingChangedRecalls(
  ctx: PageContext,
  db: D1Database,
  bucket: R2Bucket,
  key: string | undefined,
  started: string,
  fetcher: typeof fetch = fetch,
): Promise<{ since: string; submitted: number; status: number[]; advanced: boolean }> {
  // Only changes old enough that no edge cache can still serve the previous page.
  const settled = new Date(Date.parse(started) - INDEXNOW_SETTLE_MS).toISOString();
  if (!key) return { since: settled, submitted: 0, status: [], advanced: false };
  let since = settled;
  try {
    const stored = await bucket.get(INDEXNOW_WATERMARK_KEY);
    const previous = stored ? (JSON.parse(await stored.text()) as { since?: unknown }).since : undefined;
    if (typeof previous === 'string' && !Number.isNaN(Date.parse(previous)) && previous <= settled) since = previous;
    // With no usable watermark (first deploy, or deleted), record this run's
    // boundary before submitting, so a failed first submission is retried from it.
    else if (typeof previous !== 'string') await bucket.put(INDEXNOW_WATERMARK_KEY, JSON.stringify({ since }), { httpMetadata: { contentType: 'application/json' } });
    const rows = await db
      .prepare(`SELECT recall_number FROM recall WHERE changed_at >= ? AND changed_at < ? AND ${INDEXABLE_SQL} ORDER BY recall_number`)
      .bind(since, settled)
      .all<{ recall_number: string }>();
    const numbers = rows.results.map((row) => row.recall_number).filter(isRoutableRecallNumber);
    const status: number[] = [];
    for (const body of indexNowBodies(ctx, key, numbers)) {
      const response = await fetcher(INDEXNOW_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body });
      status.push(response.status);
    }
    const advanced = status.every((code) => code >= 200 && code < 300);
    if (advanced) await bucket.put(INDEXNOW_WATERMARK_KEY, JSON.stringify({ since: settled }), { httpMetadata: { contentType: 'application/json' } });
    return { since, submitted: numbers.length, status, advanced };
  } catch (error) {
    console.error('indexnow_error', error instanceof Error ? error.message : String(error));
    return { since, submitted: 0, status: [], advanced: false };
  }
}
