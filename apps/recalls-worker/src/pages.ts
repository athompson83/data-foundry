/**
 * Server-rendered pages for data.aroqon.com. Plain HTML and one stylesheet:
 * no client framework, no third-party scripts, no tracking.
 */

import { PLANS, PLAN_IDS } from './account.js';
import { catalogJsonLd, recallsDataset } from './seo.js';

export interface PageContext {
  readonly publicOrigin: string;
  readonly apiOrigin: string;
  readonly supportEmail: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
}

const CSS = `
:root{--bg:#fbfaf7;--fg:#16181d;--muted:#5b6170;--line:#e4e1d8;--card:#fff;--accent:#0b5d4b;--accent-fg:#fff;--code:#f2efe7;--warn:#8a4b00}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9e7e1;--muted:#a3a7b0;--line:#2a2e35;--card:#171a1f;--accent:#46c29d;--accent-fg:#06221b;--code:#1e2229;--warn:#f0b35a}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}main{max-width:980px;margin:0 auto;padding:0 16px 64px}
header.site{max-width:980px;margin:0 auto;padding:18px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
header.site a.brand{font-weight:700;text-decoration:none;color:var(--fg);letter-spacing:-.01em}
header.site nav a{margin-left:16px;color:var(--muted);text-decoration:none;font-size:15px}
h1{font-size:clamp(30px,5vw,46px);line-height:1.1;letter-spacing:-.02em;margin:40px 0 14px}
h2{font-size:24px;letter-spacing:-.01em;margin:48px 0 12px}h3{font-size:17px;margin:24px 0 6px}
p.lede{font-size:19px;color:var(--muted);max-width:720px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
.card h3{margin-top:0}.price{font-size:30px;font-weight:700}.price small{font-size:14px;color:var(--muted);font-weight:400}
.muted{color:var(--muted)}.small{font-size:14px}
button,.button{display:inline-block;border:0;border-radius:8px;background:var(--accent);color:var(--accent-fg);font:600 15px/1 inherit;padding:11px 16px;cursor:pointer;text-decoration:none}
button.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
pre,code{font:13.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre{background:var(--code);border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto}
code{background:var(--code);padding:1px 5px;border-radius:4px}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.table-wrap{overflow-x:auto}.key{font-size:16px;word-break:break-all;padding:14px;background:var(--code);border:1px dashed var(--accent);border-radius:10px}
.notice{border-left:3px solid var(--warn);padding:8px 14px;background:var(--card)}
footer{max-width:980px;margin:0 auto;padding:24px 16px 48px;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
`;

export interface LayoutOptions {
  readonly noindex?: boolean;
  /** A robots directive other than plain noindex, e.g. "noindex, follow" for navigation hubs. */
  readonly robots?: string;
  readonly path?: string;
  /** schema.org objects, emitted as JSON-LD for search engines and LLM crawlers. */
  readonly jsonLd?: readonly unknown[];
}

/** JSON-LD inside <script>: escape "<" so text such as "</script>" cannot end the block. */
export function jsonLdScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

export function layout(ctx: PageContext, title: string, description: string, body: string, options: LayoutOptions = {}): string {
  const robots = options.robots ?? (options.noindex ? 'noindex' : null);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
${robots ? `<meta name="robots" content="${robots}">` : ''}${options.path ? `<link rel="canonical" href="${ctx.publicOrigin}${options.path}">` : ''}
<link rel="alternate" type="text/plain" title="LLM summary" href="/llms.txt"><link rel="service-desc" type="application/json" href="${ctx.apiOrigin}/openapi.json">
${(options.jsonLd ?? []).map(jsonLdScript).join('')}
<style>${CSS}</style></head><body>
<header class="site"><a class="brand" href="/">Data Foundry</a><nav><a href="/recalls">Recall API</a><a href="/recalls/browse">Browse recalls</a><a href="/recalls/docs">Docs</a><a href="/recalls#pricing">Pricing</a></nav></header>
<main>${body}</main>
<footer>Data Foundry by Aroqon Data · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a><br>
Recall data: U.S. Food and Drug Administration via <a href="https://open.fda.gov">openFDA</a> (CC0). Not affiliated with or endorsed by FDA.</footer>
</body></html>`;
}

function planCards(): string {
  return PLAN_IDS.map((id) => {
    const plan = PLANS[id];
    return `<div class="card"><h3>${plan.name}</h3><div class="price">$${plan.monthlyUsd}<small>/month</small></div>
<p class="muted small">${plan.requests.toLocaleString('en-US')} requests per month. Hard stop at the allowance — never an overage bill.</p>
<form method="post" action="/recalls/checkout"><input type="hidden" name="plan" value="${id}"><button ${id === 'evaluate' ? 'class="secondary"' : ''}>${id === 'evaluate' ? 'Get a free key' : `Subscribe — ${plan.name}`}</button></form></div>`;
  }).join('');
}

export function catalogPage(ctx: PageContext): string {
  return layout(
    ctx,
    'Data Foundry — structured machine data',
    'Clean, current, evidence-backed datasets for software and agents.',
    `<h1>Structured data from messy public records.</h1>
<p class="lede">Data Foundry turns lawfully sourced, unstructured records into clean, current, provenance-linked data for machines — over a simple API.</p>
<h2>Datasets</h2>
<div class="grid"><div class="card"><h3><a href="/recalls">FDA Recall Intelligence</a></h3>
<p class="muted small">Every FDA food, drug and device enforcement report on openFDA (reports from June 2012 on), with distribution states, lot numbers, UPC/GTIN/UDI, NDC, expiry dates, allergens and pathogens extracted from the free text.</p></div></div>`,
    { path: '/', jsonLd: [catalogJsonLd(ctx)] },
  );
}

export function recallsLanding(ctx: PageContext): string {
  const example = `curl "${ctx.apiOrigin}/v1/recalls/lookup?code=00801741121067" \\
  -H "Authorization: Bearer $DATA_FOUNDRY_KEY"`;
  return layout(
    ctx,
    'FDA Recall Intelligence API — lot, UPC, UDI and NDC recall lookup',
    'Structured FDA food, drug and device recalls: distribution states, lots, GTIN/UPC/UDI, NDC, expiry dates, allergens and pathogens, with source provenance.',
    `<h1>Is this product recalled — and where?</h1>
<p class="lede">FDA publishes recalls as prose: “distributed to FL, GA, IL and the countries of Guatemala and Panama”, “Lot #: DJ23254, Exp. Date 11/30/2026”. This API turns that text into exact, queryable fields — so one call answers whether a UPC, UDI, NDC or lot is under recall, and in which states.</p>
<pre><code>${escapeHtml(example)}</code></pre>
<h2>What you get</h2>
<div class="grid">
<div class="card"><h3>Exact identifiers</h3><p class="muted small">UPC/EAN/GTIN/UDI-DI (check-digit verified, normalised to GTIN-14), NDC (normalised to 5-4-2), lot, serial and model numbers, expiration dates.</p></div>
<div class="card"><h3>Distribution geography</h3><p class="muted small">US states and territories, countries (ISO codes), nationwide and international flags — parsed from free-text distribution patterns.</p></div>
<div class="card"><h3>Why it was recalled</h3><p class="muted small">Reason classes (allergen, microbial, foreign material, labeling, sterility…), the nine major allergens and named pathogens.</p></div>
<div class="card"><h3>Provenance on every record</h3><p class="muted small">The verbatim FDA record, its SHA-256, parser version, source URL, and first-seen / last-seen / changed timestamps. We check openFDA every six hours; how recent the newest report is depends on FDA's own publication schedule.</p></div>
</div>
<h2>Coverage</h2>
<p class="muted">Every enforcement report openFDA publishes for food, drugs and medical devices — reports from June 2012 on, about 87,000 recalls. Live counts, the latest FDA report date and our last successful sync: <a href="${ctx.apiOrigin}/v1/recalls/stats">/v1/recalls/stats</a>.</p>
<h2 id="pricing">Pricing</h2>
<div class="grid">${planCards()}</div>
<p class="small muted">Monthly, billed by Stripe. Upgrade, downgrade or cancel any time from the billing portal. Your key is shown immediately after checkout.</p>
<h2>Good for</h2>
<p class="muted">Retail and grocery systems checking inventory against recalls · pharmacy and hospital supply chains matching NDCs and UDIs · marketplaces screening listings · compliance and QA dashboards · AI agents that need a reliable recall answer instead of a web search.</p>
<h2>Browse every recall</h2>
<p class="muted">Each recall has a public page with its codes, distribution and reasons: <a href="/recalls/browse">browse by product type and year</a>. Agents: see <a href="/llms.txt">/llms.txt</a>.</p>`,
    { path: '/recalls', jsonLd: [recallsDataset(ctx)] },
  );
}

export function docsPage(ctx: PageContext): string {
  const api = ctx.apiOrigin;
  const rows: Array<[string, string]> = [
    ['gtin', 'UPC, EAN, GTIN or UDI-DI. Any length 8–14 with a valid check digit; matched as GTIN-14.'],
    ['ndc', 'National Drug Code. A package code (any hyphenated layout or 11 digits) matches that package or a recall of its whole product; a product code (4-4, 5-3, 5-4) matches the product and all its packages.'],
    ['lot, serial, model', 'Exact code as printed (case-insensitive).'],
    ['state', 'Two-letter USPS code. Nationwide recalls always match.'],
    ['country', 'ISO 3166-1 alpha-2 code.'],
    ['category', '<code>food</code>, <code>drug</code> or <code>device</code>.'],
    ['classification', '<code>I</code>, <code>II</code> or <code>III</code>.'],
    ['status', '<code>Ongoing</code>, <code>Completed</code>, <code>Terminated</code> or <code>Pending</code>.'],
    ['reason_class', 'UNDECLARED_ALLERGEN, MICROBIAL_CONTAMINATION, FOREIGN_MATERIAL, CHEMICAL_CONTAMINATION, LABELING, POTENCY, STERILITY, CGMP, SPECIFICATION_FAILURE, PACKAGING, TEMPERATURE_CONTROL, DEVICE_MALFUNCTION, SOFTWARE, UNAPPROVED_PRODUCT.'],
    ['allergen', 'milk, egg, fish, crustacean_shellfish, tree_nuts, peanut, wheat, soy, sesame.'],
    ['pathogen', 'listeria_monocytogenes, salmonella, e_coli, clostridium_botulinum, cronobacter, hepatitis_a, norovirus, cyclospora, bacillus_cereus, staphylococcus, burkholderia, pseudomonas, mold, yeast.'],
    ['firm', 'Substring of the recalling firm name.'],
    ['q', 'Full-text search over firm, product description and reason.'],
    ['reported_from, reported_to', 'FDA report date bounds, YYYY-MM-DD.'],
    ['changed_since', 'ISO timestamp — records whose FDA text changed since then (for incremental sync).'],
    ['limit, cursor', 'Page size 1–100 (default 25) and the <code>next_cursor</code> from the previous page.'],
    ['include=raw', 'Add the verbatim FDA record to each result.'],
  ];
  return layout(
    ctx,
    'Docs — FDA Recall Intelligence API',
    'Endpoints, parameters, authentication and limits for the FDA Recall Intelligence API.',
    `<h1>API documentation</h1>
<p class="lede">Base URL <code>${api}</code>. JSON over HTTPS. OpenAPI: <a href="${api}/openapi.json">${api}/openapi.json</a>.</p>
<h2>Authentication</h2>
<p>Send your key as <code>Authorization: Bearer rcl_live_…</code> (or <code>X-API-Key</code>). Every authenticated data request counts toward your monthly allowance; when it is spent, requests return <code>429</code> until the next UTC month or an upgrade. <code>/v1/account</code> and <code>/v1/recalls/stats</code> are not counted.</p>
<h2>Endpoints</h2>
<h3>GET /v1/recalls/lookup?code=…</h3><p>One code, every exact interpretation: GTIN/UPC/UDI (check-digit verified), NDC, lot, serial and model. Returns up to 100 matching recalls, newest first, with <code>matched_on</code>, plus <code>total_matches</code> and <code>truncated</code>; when truncated, page through every match with the <code>/v1/recalls</code> filters listed in <code>complete_results</code>. Lot, serial and model codes ignore internal spaces.</p>
<pre><code>curl "${api}/v1/recalls/lookup?code=05708932072526" -H "Authorization: Bearer $KEY"</code></pre>
<h3>GET /v1/recalls</h3><p>Filter and page through recalls, newest report first. Filters combine with AND.</p>
<div class="table-wrap"><table><thead><tr><th>Parameter</th><th>Meaning</th></tr></thead><tbody>${rows.map(([name, text]) => `<tr><td><code>${name}</code></td><td>${text}</td></tr>`).join('')}</tbody></table></div>
<pre><code>curl "${api}/v1/recalls?state=TX&amp;category=food&amp;allergen=peanut&amp;status=Ongoing" -H "Authorization: Bearer $KEY"</code></pre>
<h3>GET /v1/recalls/{recall_number}</h3><p>One recall, e.g. <code>/v1/recalls/H-1331-2026?include=raw</code>.</p>
<h3>GET /v1/account</h3><p>Your plan, this month's usage and allowance.</p>
<h3>POST /v1/account/rotate-key</h3><p>Revokes the presented key and returns a new one.</p>
<h3>POST /v1/account/billing-portal</h3><p>Returns a Stripe billing-portal URL to upgrade, downgrade or cancel.</p>
<h3>GET /v1/recalls/stats</h3><p>Public coverage counts and last refresh time.</p>
<h2>Record shape</h2>
<pre><code>{
  "recall_number": "D-0123-2026", "category": "drug", "classification": "II", "status": "Ongoing",
  "firm": { "name": "…", "city": "…", "state": "NJ", "postal_code": "…", "country": "United States" },
  "dates": { "initiated": "2026-08-01", "classified": "2026-09-04", "reported": "2026-09-16", "terminated": null },
  "distribution": { "nationwide_us": true, "international": true, "us_states": ["FL","GA"], "countries": ["PA"], … },
  "quantity": { "items": [{ "value": 403200, "unit": "tablets" }], "total": 403200, "unit": "tablets" },
  "codes": { "gtins": [], "ndcs": ["12345-0678-90"], "lots": ["DJ23254"], "expiration_dates": ["2026-11-30"], … },
  "reason": { "classes": ["SPECIFICATION_FAILURE"], "allergens": [], "pathogens": [] },
  "provenance": { "source_url": "https://api.fda.gov/…", "parser_version": "recall-structuring@1", "raw_sha256": "…", "changed_at": "…" }
}</code></pre>
<h2>Accuracy</h2>
<p class="notice">Derived fields come from deterministic parsers over FDA prose. They are conservative — a code is only reported when an explicit marker or a valid check digit supports it — but they can be incomplete. The verbatim FDA text is always included for verification. This is not medical or legal advice; do not rely on it for decisions about medical care.</p>
<h2>Errors</h2>
<p><code>400</code> invalid parameter · <code>401</code> missing/unknown key · <code>403</code> subscription inactive · <code>404</code> not found · <code>429</code> monthly allowance spent · <code>503</code> temporarily unavailable. Errors are <code>{"error": {"code", "message"}}</code>.</p>`,
    { path: '/recalls/docs' },
  );
}

export function welcomePage(ctx: PageContext, key: string, planName: string): string {
  return layout(
    ctx,
    'Your API key — Data Foundry',
    'Your Recall Intelligence API key.',
    `<h1>You're in.</h1><p class="lede">Plan: <strong>${escapeHtml(planName)}</strong>. Here is your API key. It is shown <strong>only once</strong> — copy it into your secret store now.</p>
<p class="key"><code>${escapeHtml(key)}</code></p>
<pre><code>curl "${ctx.apiOrigin}/v1/recalls?limit=3" -H "Authorization: Bearer ${escapeHtml(key)}"</code></pre>
<p>Next: <a href="/recalls/docs">read the docs</a>. Manage billing any time with <code>POST ${ctx.apiOrigin}/v1/account/billing-portal</code>. Lost key? Email <a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a> from the email address you checked out with; we will verify it against your billing record, revoke the old key and send a new one.</p>`,
    { noindex: true },
  );
}

export function messagePage(ctx: PageContext, title: string, message: string): string {
  return layout(ctx, `${title} — Data Foundry`, title, `<h1>${escapeHtml(title)}</h1><p class="lede">${message}</p><p><a href="/recalls">Back to Recall Intelligence</a></p>`, { noindex: true });
}

export function termsPage(ctx: PageContext): string {
  return layout(
    ctx,
    'Terms of Service — Data Foundry',
    'Terms of Service for Data Foundry APIs.',
    `<h1>Terms of Service</h1><p class="muted">Effective 2026-09-26. Operator: Aroqon Data (“we”). Contact: <a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a>.</p>
<h3>1. The service</h3><p>We provide API access to datasets we compile and structure from lawfully obtained sources. The FDA Recall Intelligence dataset is derived from U.S. Food and Drug Administration enforcement reports published through openFDA under CC0. We are not affiliated with or endorsed by FDA.</p>
<h3>2. Accounts and keys</h3><p>Keep your API key secret; you are responsible for use of your key. You may rotate it at any time. We may suspend keys used abusively or in breach of these terms.</p>
<h3>3. Plans, billing and cancellation</h3><p>Paid plans are billed monthly in advance in USD by Stripe and renew until cancelled. Each plan includes a monthly request allowance; requests beyond it are refused (HTTP 429) and never billed as overage. You can upgrade, downgrade or cancel from the billing portal; cancellation takes effect at the end of the paid period. Fees are non-refundable except where required by law. Access ends if payment fails and is not resolved.</p>
<h3>4. Acceptable use</h3><p>Do not attempt to circumvent allowances, share keys across unrelated organisations, overload the service, or use it unlawfully. You may use and redistribute the data returned to you, including commercially, with attribution to FDA/openFDA where practicable.</p>
<h3>5. No warranty</h3><p>The data is provided “as is”. Derived fields are produced by automated parsers from FDA text and may be incomplete or inaccurate; the verbatim source record is provided for verification. The service is not medical, legal or regulatory advice and must not be the sole basis for decisions about medical care, product safety or compliance. Always confirm against the official FDA recall notice.</p>
<h3>6. Liability</h3><p>To the maximum extent permitted by law, our total liability for any claim is limited to the fees you paid in the three months before the claim, and we are not liable for indirect or consequential losses.</p>
<h3>7. Changes</h3><p>We may change these terms or the service with notice on this page; material changes to paid plans take effect at your next billing period.</p>`,
    { path: '/terms' },
  );
}

export function privacyPage(ctx: PageContext): string {
  return layout(
    ctx,
    'Privacy — Data Foundry',
    'How Data Foundry handles customer data.',
    `<h1>Privacy</h1><p class="muted">Effective 2026-09-26. Operator: Aroqon Data. Contact: <a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a>.</p>
<h3>What we collect</h3><p>Your email and billing details are collected and held by Stripe, our payment processor; we store your Stripe customer and subscription identifiers, email, plan and status. For API keys we store only a one-way hash. We count requests per customer per month to enforce allowances. We do not store request parameters, and we use no advertising or tracking cookies.</p>
<h3>Why</h3><p>To provide the service, bill for it, enforce allowances, prevent abuse and support you.</p>
<h3>Sharing</h3><p>With Stripe (payments) and Cloudflare (hosting and network), as processors. We do not sell personal data.</p>
<h3>Retention</h3><p>Account records are kept while your account is active and for up to 7 years after for tax and accounting; monthly usage counters for 24 months. Email us to request access to or deletion of your data, subject to legal retention duties.</p>
<h3>The dataset</h3><p>The recall dataset contains information about recalling firms as published by FDA; it is not a dataset about individuals.</p>`,
    { path: '/privacy' },
  );
}
