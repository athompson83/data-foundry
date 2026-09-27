/**
 * Public pages for the North American consumer-product recall dataset: a
 * landing page, one page per agency notice, crawlable year hubs and sitemap
 * shards. Pages read the same D1 rows and presenter as the API (AGENTS.md
 * rule 5) and show nothing the API does not.
 */

import type { D1Database } from './env.js';
import { escapeHtml, layout, type PageContext } from './pages.js';
import { presentRows, type PresentedProductRecall } from './product-api.js';
import { organization, productDataset } from './seo.js';

export const PRODUCT_PAGE_PATTERN = /^\/product-recalls\/(cpsc-\d{5}[a-z]?|hc-\d{1,8})$/;
export const PRODUCT_BROWSE_PATTERN = /^\/product-recalls\/browse\/(cpsc|hc)\/(\d{4})$/;
export const PRODUCT_SITEMAP_PATTERN = /^\/sitemaps\/product-recalls-([1-9]\d{0,2})\.xml$/;
export const PRODUCT_SITEMAP_PAGE_SIZE = 20_000;
export const PRODUCT_BROWSE_PAGE_SIZE = 200;
export const FIRST_PRODUCT_YEAR = 1973;

const AGENCY_NAME: Readonly<Record<string, string>> = { CPSC: 'U.S. Consumer Product Safety Commission', HC: 'Health Canada' };
const AGENCY_SHORT: Readonly<Record<string, string>> = { CPSC: 'CPSC', HC: 'Health Canada' };

export function productLanding(ctx: PageContext): string {
  const example = `curl "${ctx.apiOrigin}/v1/product-recalls/lookup?code=DXH70CFAVX" \\
  -H "Authorization: Bearer $DATA_FOUNDRY_KEY"`;
  return layout(
    ctx,
    'Consumer Product Recall API — CPSC and Health Canada, by model number and UPC',
    'CPSC and Health Canada consumer-product recalls in one schema: model numbers, UPC/GTIN, units, hazards, remedies, trade facets and linked joint recalls, with source provenance.',
    `<h1>Is this appliance, tool or toy recalled in the US or Canada?</h1>
<p class="lede">CPSC and Health Canada publish recalls as prose: “model number DXH70CFAVX”, “About 21,250 (In addition, about 500 were sold in Canada)”. This API turns both agencies' notices into one set of exact, queryable fields and links a US recall to its Canadian counterpart wherever CPSC cites it.</p>
<pre><code>${escapeHtml(example)}</code></pre>
<h2>What you get</h2>
<div class="grid">
<div class="card"><h3>Exact identifiers</h3><p class="muted small">Model numbers read only after an explicit “model” label, and UPC/EAN/GTIN verified by check digit and normalised to GTIN-14.</p></div>
<div class="card"><h3>One taxonomy, two agencies</h3><p class="muted small">Hazard classes (fire, shock, carbon monoxide, tip-over, choking…), remedy classes (refund, repair, replace…), and appliance, HVAC, plumbing, electrical and building-product facets.</p></div>
<div class="card"><h3>Linked joint recalls</h3><p class="muted small">A CPSC notice that cites a Health Canada notice is linked to it. Name or title similarity never links notices.</p></div>
<div class="card"><h3>Provenance on every record</h3><p class="muted small">Each record carries the agency source URL, the SHA-256 of the verbatim source record, the parser version and first-seen/changed timestamps. We check both agencies every six hours.</p></div>
</div>
<h2 id="api">API</h2>
<p><code>GET ${escapeHtml(ctx.apiOrigin)}/v1/product-recalls/lookup?code=&lt;model or UPC&gt;</code> · <code>GET /v1/product-recalls?hazard=fire&amp;facet=appliance&amp;agency=CPSC</code> · <code>GET /v1/product-recalls/&lt;id&gt;</code> · live coverage without a key: <a href="${escapeHtml(ctx.apiOrigin)}/v1/product-recalls/stats">/v1/product-recalls/stats</a>. Full reference: <a href="/llms-full.txt">llms-full.txt</a> and <a href="${escapeHtml(ctx.apiOrigin)}/openapi.json">OpenAPI</a>.</p>
<h2>Keys and pricing</h2>
<p class="muted">The same keys and monthly plans as the FDA recall API cover this dataset, including the free Evaluate plan: <a href="/recalls#pricing">see plans</a>.</p>
<h2>Browse</h2>
<p class="muted"><a href="/product-recalls/browse">Every notice by agency and year</a>. Agents: see <a href="/llms.txt">/llms.txt</a>.</p>
<p class="small muted">Sources: U.S. Consumer Product Safety Commission (US Government work). Health Canada Recalls and Safety Alerts: contains information licensed under the <a href="https://open.canada.ca/en/open-government-licence-canada">Open Government Licence – Canada</a>. Not affiliated with or endorsed by CPSC, Health Canada or the Government of Canada.</p>`,
    { path: '/product-recalls', jsonLd: [productDataset(ctx)] },
  );
}

function list(values: readonly string[], limit: number): string {
  const shown = values.slice(0, limit).map((value) => `<code>${escapeHtml(value)}</code>`).join(', ');
  return values.length > limit ? `${shown} and ${values.length - limit} more` : shown;
}

const label = (value: string): string => value.replace(/-/g, ' ');
const number = (value: number | null): string | null => (value === null ? null : value.toLocaleString('en-US'));

export function noticeTitle(recall: PresentedProductRecall): string {
  return `${recall.title} — ${AGENCY_SHORT[recall.agency] ?? recall.agency} recall ${recall.source_id}`.slice(0, 180);
}

export function noticeDescription(recall: PresentedProductRecall): string {
  const date = recall.published_on ?? recall.updated_on;
  const hazards = recall.hazard.classes.length ? ` Hazards: ${recall.hazard.classes.map(label).join(', ')}.` : '';
  const models = recall.identifiers.model_numbers.length ? ` Models: ${recall.identifiers.model_numbers.slice(0, 6).join(', ')}${recall.identifiers.model_numbers.length > 6 ? '…' : ''}.` : '';
  const units = recall.units.us !== null ? ` About ${number(recall.units.us)} units in the US${recall.units.canada !== null ? ` and ${number(recall.units.canada)} in Canada` : ''}.` : '';
  return `${AGENCY_NAME[recall.agency] ?? recall.agency} recall${date ? ` (${date})` : ''}.${hazards}${models}${units}`.slice(0, 300);
}

export function noticePage(ctx: PageContext, recall: PresentedProductRecall, indexable: boolean): string {
  const path = `/product-recalls/${recall.id}`;
  const rows: Array<[string, string]> = [];
  const add = (name: string, value: string | null | undefined): void => {
    if (value) rows.push([name, value]);
  };
  add('Agency', escapeHtml(AGENCY_NAME[recall.agency] ?? recall.agency));
  add(recall.agency === 'CPSC' ? 'Recall number' : 'Notice id', `<code>${escapeHtml(recall.source_id)}</code>`);
  add('Published', recall.published_on);
  add('Last updated', recall.updated_on);
  add('Recall class', recall.recall_class ? escapeHtml(recall.recall_class) : null);
  add('Archived by the agency', recall.archived === null ? null : recall.archived ? 'Yes' : 'No');
  add('Product category', recall.product_category ? escapeHtml(recall.product_category) : null);
  add('Products', recall.products.length ? escapeHtml(recall.products.map((product) => product.name).join('; ')) : null);
  add('Firm named in the title', recall.title_firm ? escapeHtml(recall.title_firm) : null);
  add('Firms', recall.firms.length ? escapeHtml(recall.firms.map((firm) => `${firm.name} (${firm.role})`).join('; ')) : null);
  add('Manufactured in', recall.manufacturer_countries.length ? escapeHtml(recall.manufacturer_countries.join(', ')) : null);
  add('Units (US)', number(recall.units.us));
  add('Units (Canada)', number(recall.units.canada));
  add('Units (Mexico)', number(recall.units.mexico));
  add('Model numbers', recall.identifiers.model_numbers.length ? list(recall.identifiers.model_numbers, 40) : null);
  add('UPC / GTIN', recall.identifiers.gtins.length ? list(recall.identifiers.gtins, 25) : null);
  add('Hazard classes', recall.hazard.classes.length ? escapeHtml(recall.hazard.classes.map(label).join(', ')) : null);
  add('Remedy classes', recall.remedy.classes.length ? escapeHtml(recall.remedy.classes.map(label).join(', ')) : null);
  add('Trade facets', recall.trade_facets.length ? escapeHtml(recall.trade_facets.map(label).join(', ')) : null);
  add('Sold', recall.sold_at.length ? escapeHtml(recall.sold_at.join(' ')) : null);
  const linked = recall.linked_notices.length
    ? `<h2>Linked notices</h2><p class="muted small">Linked because one agency's notice cites the other's.</p><ul>${recall.linked_notices
        .map((link) => `<li><a href="/product-recalls/${escapeHtml(link.id)}">${escapeHtml(link.title)}</a> <span class="muted small">(${escapeHtml(AGENCY_SHORT[link.agency] ?? link.agency)})</span></li>`)
        .join('')}</ul>`
    : '';
  const text = (heading: string, value: string | null): string => (value ? `<h2>${heading}</h2><p>${escapeHtml(value)}</p>` : '');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${ctx.publicOrigin}${path}`,
    url: `${ctx.publicOrigin}${path}`,
    name: noticeTitle(recall),
    description: noticeDescription(recall),
    dateModified: recall.provenance.changed_at,
    ...(recall.published_on ? { datePublished: recall.published_on } : {}),
    isPartOf: { '@id': `${ctx.publicOrigin}/product-recalls#dataset` },
    publisher: organization(ctx),
    isBasedOn: recall.provenance.source_url,
    about: {
      '@type': 'Product',
      name: recall.products[0]?.name || recall.title,
      ...(recall.identifiers.gtins.length ? { gtin: recall.identifiers.gtins[0] } : {}),
      ...(recall.identifiers.model_numbers.length ? { model: recall.identifiers.model_numbers[0] } : {}),
    },
  };
  const year = (recall.published_on ?? recall.updated_on ?? '').slice(0, 4);
  const attribution =
    recall.agency === 'CPSC'
      ? `Source: <a href="${escapeHtml(recall.provenance.source_url)}">U.S. Consumer Product Safety Commission recall notice</a> (US Government work). Not affiliated with or endorsed by CPSC.`
      : `Source: <a href="${escapeHtml(recall.provenance.source_url)}">Health Canada recall notice</a>. Contains information licensed under the <a href="https://open.canada.ca/en/open-government-licence-canada">Open Government Licence – Canada</a>. Not affiliated with or endorsed by Health Canada or the Government of Canada.`;
  const body = `<p class="small muted"><a href="/product-recalls/browse/${recall.agency.toLowerCase()}/${escapeHtml(year || 'all')}">${escapeHtml(AGENCY_SHORT[recall.agency] ?? '')} recalls ${escapeHtml(year)}</a></p>
<h1>${escapeHtml(recall.title)}</h1>
<p class="lede">${escapeHtml(noticeDescription(recall))}</p>
<div class="table-wrap"><table>${rows.map(([name, value]) => `<tr><th scope="row">${name}</th><td>${value}</td></tr>`).join('')}</table></div>
${text('Description', recall.description)}${text('Hazard', recall.hazard.text)}${text('Remedy', recall.remedy.text)}${text('Incidents and injuries', recall.injuries)}${linked}
<h2>Machine access</h2>
<p class="muted">This record, with every extracted field, the verbatim source record and provenance: <code>GET ${escapeHtml(ctx.apiOrigin)}/v1/product-recalls/${escapeHtml(recall.id)}</code>. Look up a model number or UPC with <code>/v1/product-recalls/lookup?code=…</code>. <a href="/product-recalls">About the dataset</a> · <a href="/recalls#pricing">free and paid keys</a>.</p>
<p class="small muted">${attribution} Structured by Data Foundry (${escapeHtml(recall.provenance.parser_version)}); last changed ${escapeHtml(recall.provenance.changed_at.slice(0, 10))}. Always confirm with the agency notice.</p>`;
  return layout(ctx, noticeTitle(recall), noticeDescription(recall), body, { path, jsonLd: [jsonLd], ...(indexable ? {} : { robots: 'noindex, follow' }) });
}

/** The page for one notice id, or null when it does not exist. */
export async function productNoticePage(ctx: PageContext, db: D1Database, id: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT id, agency, url_key, structured, raw_ref, raw_sha256, first_seen_at, last_seen_at, changed_at, sort_date, indexable FROM product_recall WHERE id = ?')
    .bind(id)
    .first<Parameters<typeof presentRows>[2][number] & { indexable: number }>();
  if (!row) return null;
  const [recall] = await presentRows(db, { get: async () => null, put: async () => undefined }, [row], false);
  return noticePage(ctx, recall as PresentedProductRecall, row.indexable === 1);
}

export async function productBrowseIndex(ctx: PageContext, db: D1Database): Promise<string> {
  const rows = await db
    .prepare('SELECT agency, substr(sort_date, 1, 4) AS year, COUNT(*) AS n FROM product_recall GROUP BY agency, year ORDER BY agency, year DESC')
    .all<{ agency: string; year: string; n: number }>();
  const byAgency = new Map<string, Array<{ year: string; n: number }>>();
  for (const row of rows.results) byAgency.set(row.agency, [...(byAgency.get(row.agency) ?? []), { year: row.year, n: row.n }]);
  const sections = [...byAgency]
    .map(([agency, years]) => `<h2>${escapeHtml(AGENCY_NAME[agency] ?? agency)}</h2><p>${years.map((y) => `<a href="/product-recalls/browse/${agency.toLowerCase()}/${escapeHtml(y.year)}">${escapeHtml(y.year)}</a> <span class="muted small">(${y.n.toLocaleString('en-US')})</span>`).join(' · ')}</p>`)
    .join('');
  return layout(ctx, 'Browse CPSC and Health Canada recalls by year — Data Foundry', 'Every CPSC recall and Health Canada consumer-product recall, by agency and year.', `<h1>Browse consumer product recalls</h1><p class="lede">One page per agency notice, with model numbers, UPCs, units, hazards and linked joint recalls.</p>${sections}`, {
    path: '/product-recalls/browse',
    robots: 'noindex, follow',
  });
}

export async function productBrowsePage(ctx: PageContext, db: D1Database, agency: string, year: string, page: number): Promise<string | null> {
  const upper = agency.toUpperCase();
  const rows = await db
    .prepare('SELECT id, title, sort_date FROM product_recall WHERE agency = ? AND sort_date >= ? AND sort_date < ? ORDER BY sort_date DESC, id LIMIT ? OFFSET ?')
    .bind(upper, `${year}-01-01`, `${Number(year) + 1}-01-01`, PRODUCT_BROWSE_PAGE_SIZE + 1, (page - 1) * PRODUCT_BROWSE_PAGE_SIZE)
    .all<{ id: string; title: string; sort_date: string }>();
  if (rows.results.length === 0) return null;
  const base = `/product-recalls/browse/${agency}/${year}`;
  const nav = [page > 1 ? `<a href="${base}${page === 2 ? '' : `?page=${page - 1}`}">← Newer</a>` : '', rows.results.length > PRODUCT_BROWSE_PAGE_SIZE ? `<a href="${base}?page=${page + 1}">Older →</a>` : ''].filter(Boolean).join(' · ');
  const items = rows.results
    .slice(0, PRODUCT_BROWSE_PAGE_SIZE)
    .map((row) => `<tr><td>${escapeHtml(row.sort_date)}</td><td><a href="/product-recalls/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a></td></tr>`)
    .join('');
  const name = `${AGENCY_SHORT[upper] ?? upper} recalls, ${year}`;
  return layout(ctx, `${name}${page > 1 ? ` (page ${page})` : ''} — Data Foundry`, `${name}, with model numbers, UPCs, hazards and linked notices.`, `<p class="small muted"><a href="/product-recalls/browse">All agencies and years</a></p><h1>${escapeHtml(name)}</h1><p>${nav}</p><div class="table-wrap"><table><tr><th>Date</th><th>Notice</th></tr>${items}</table></div><p>${nav}</p>`, {
    path: `${base}${page > 1 ? `?page=${page}` : ''}`,
    robots: 'noindex, follow',
  });
}

export async function productIndexableStats(db: D1Database): Promise<{ n: number; last: string | null }> {
  const row = await db.prepare('SELECT COUNT(*) AS n, MAX(changed_at) AS last FROM product_recall WHERE indexable = 1').first<{ n: number; last: string | null }>();
  return { n: row?.n ?? 0, last: row?.last ?? null };
}

export async function productSitemap(ctx: PageContext, db: D1Database, page: number): Promise<string | null> {
  const rows = await db
    .prepare('SELECT id, changed_at FROM product_recall WHERE indexable = 1 ORDER BY id LIMIT ? OFFSET ?')
    .bind(PRODUCT_SITEMAP_PAGE_SIZE, (page - 1) * PRODUCT_SITEMAP_PAGE_SIZE)
    .all<{ id: string; changed_at: string }>();
  if (rows.results.length === 0) return null;
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.results
    .map((row) => `<url><loc>${ctx.publicOrigin}/product-recalls/${encodeURIComponent(row.id)}</loc><lastmod>${row.changed_at.slice(0, 10)}</lastmod></url>`)
    .join('')}</urlset>`;
}
