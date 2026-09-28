/**
 * Server-rendered pages for data.aroqon.com. Plain HTML and one stylesheet:
 * no client framework, no third-party scripts, no tracking.
 */

import { PLANS, PLAN_IDS } from './account.js';

export interface PageContext {
  readonly publicOrigin: string;
  readonly apiOrigin: string;
  readonly supportEmail: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
}

const CSS = `
:root{--bg:#fbfaf7;--fg:#15171c;--muted:#565c6a;--line:#e3e0d6;--card:#fff;--accent:#0b5d4b;--accent-fg:#fff;--accent-soft:#e3f1ec;--code:#f3f0e8;--code-fg:#1d2330;--warn:#8a4b00;--focus:#1a56db}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9e7e1;--muted:#a6aab3;--line:#2a2e35;--card:#171a1f;--accent:#46c29d;--accent-fg:#06221b;--accent-soft:#16302a;--code:#1b1f26;--code-fg:#e2e5ea;--warn:#f0b35a;--focus:#8ab4ff}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-underline-offset:2px}main{max-width:1080px;margin:0 auto;padding:24px 20px 72px}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:4px}
.skip{position:absolute;left:-999px;top:8px;background:var(--card);padding:8px 12px;border-radius:6px;z-index:10}.skip:focus{left:12px}
header.site{max-width:1080px;margin:0 auto;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
header.site a.brand{font-weight:750;text-decoration:none;color:var(--fg);letter-spacing:-.015em;font-size:18px}
header.site nav{display:flex;gap:18px;flex-wrap:wrap}header.site nav a{color:var(--muted);text-decoration:none;font-size:15px;padding:4px 0}
header.site nav a:hover{color:var(--fg)}
h1{font-size:clamp(32px,5.4vw,52px);line-height:1.06;letter-spacing:-.025em;margin:44px 0 16px;max-width:17ch}
h2{font-size:clamp(24px,3vw,30px);letter-spacing:-.015em;margin:64px 0 10px;line-height:1.2}h3{font-size:17px;margin:22px 0 6px}
.eyebrow{font-size:13px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin:0}
p.lede{font-size:19px;color:var(--muted);max-width:680px;margin-top:0}
.hero{display:grid;gap:36px;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);align-items:start;padding-bottom:12px}
@media (max-width:880px){.hero{grid-template-columns:minmax(0,1fr)}}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0 8px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.card h3{margin-top:0}.price{font-size:30px;font-weight:700}.price small{font-size:14px;color:var(--muted);font-weight:400}
.catalog{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.catalog-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,400px);gap:10px 28px;padding:18px 4px;border-bottom:1px solid var(--line)}
.catalog-row h3{font-size:18px;margin:0 0 6px}.catalog-row h3 a{color:var(--fg)}.catalog-row h3 a:hover{color:var(--accent)}.catalog-row p{margin:0 0 6px}
.tags{display:flex;flex-wrap:wrap;gap:6px}.tag{font-size:12.5px;padding:2px 8px;border-radius:6px;border:1px solid var(--line);color:var(--muted)}
.catalog-meta{display:grid;grid-template-columns:90px minmax(0,1fr) 120px;gap:14px;margin:0;font-size:14.5px}.catalog-meta dd{margin:0;font-variant-numeric:tabular-nums}
.catalog-meta dt{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.catalog-head{font-size:12.5px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:18px 4px 8px;border-bottom:0}.catalog-head .catalog-meta{font-size:inherit}
@media (max-width:760px){.catalog-head{display:none}.catalog-row{grid-template-columns:minmax(0,1fr)}.catalog-meta{grid-template-columns:repeat(3,auto);justify-content:start;gap:4px 18px}.catalog-meta dt{position:static;width:auto;height:auto;clip:auto;font-size:12px;color:var(--muted)}}
.dataset{display:grid;gap:18px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);align-items:start}
@media (max-width:760px){.dataset{grid-template-columns:minmax(0,1fr)}}
.dataset h3{font-size:21px;margin:0 0 6px}.dataset h3 a{color:var(--fg);text-decoration:none}.dataset h3 a:hover{color:var(--accent)}
dl.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:14.5px}dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;font-variant-numeric:tabular-nums}
.badge{display:inline-block;font-size:12.5px;font-weight:650;padding:3px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent);margin:0 6px 6px 0}
.badge.warn{background:transparent;color:var(--warn);border:1px solid var(--warn)}
.muted{color:var(--muted)}.small{font-size:14px}
ol.steps{counter-reset:s;list-style:none;padding:0;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
ol.steps li{counter-increment:s;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
ol.steps li::before{content:counter(s);display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--accent);color:var(--accent-fg);font-weight:700;font-size:14px;margin-bottom:8px}
button,.button{display:inline-block;border:1px solid var(--accent);border-radius:9px;background:var(--accent);color:var(--accent-fg);font:600 15px/1 inherit;padding:12px 17px;cursor:pointer;text-decoration:none}
button.secondary,.button.secondary{background:transparent;color:var(--accent)}
button.copy{font-size:13px;padding:6px 10px;background:transparent;color:var(--accent)}
pre,code{font:13.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre{background:var(--code);color:var(--code-fg);border:1px solid var(--line);border-radius:12px;padding:16px;overflow:auto;margin:0}
pre.response{max-height:460px}
code{background:var(--code);padding:1px 5px;border-radius:4px}pre code{background:none;padding:0}
.window{border:1px solid var(--line);border-radius:14px;background:var(--card);overflow:hidden}
.window .bar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted);flex-wrap:wrap}
.window pre{border:0;border-radius:0}
table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.table-wrap{overflow-x:auto}.key{font-size:16px;word-break:break-all;padding:14px;background:var(--code);border:1px dashed var(--accent);border-radius:10px}
p a,li a,td a,p code,li code{overflow-wrap:anywhere}
.notice{border-left:3px solid var(--warn);padding:10px 14px;background:var(--card);border-radius:0 8px 8px 0}
details{border-bottom:1px solid var(--line);padding:12px 0}summary{cursor:pointer;font-weight:600}details p{margin:8px 0 0;color:var(--muted)}
footer{max-width:1080px;margin:0 auto;padding:28px 20px 56px;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
footer nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px}
`;

export interface LayoutOptions {
  readonly noindex?: boolean;
  /** A robots directive other than plain noindex, e.g. "noindex, follow" for navigation hubs. */
  readonly robots?: string;
  readonly path?: string;
  /** schema.org objects, emitted as JSON-LD for search engines and LLM crawlers. */
  readonly jsonLd?: readonly unknown[];
  /** Load /assets/site.js (copy buttons). Content never depends on it. */
  readonly scripts?: boolean;
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
<link rel="icon" href="data:,"><link rel="alternate" type="text/plain" title="LLM summary" href="/llms.txt"><link rel="service-desc" type="application/json" href="${ctx.apiOrigin}/openapi.json">
${(options.jsonLd ?? []).map(jsonLdScript).join('')}
<meta property="og:type" content="website"><meta property="og:site_name" content="Data Foundry"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}">${options.path ? `<meta property="og:url" content="${ctx.publicOrigin}${options.path}">` : ''}<meta name="twitter:card" content="summary">
<style>${CSS}</style>${options.scripts ? '<script src="/assets/site.js" defer></script>' : ''}</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="site"><a class="brand" href="/">Data Foundry</a><nav aria-label="Main"><a href="/#datasets">Datasets</a><a href="/docs">API docs</a><a href="/#pricing">Pricing</a></nav></header>
<main id="main">${body}</main>
<footer><nav aria-label="Footer"><a href="/#datasets">Datasets</a><a href="/docs">API docs</a><a href="${ctx.apiOrigin}/openapi.json">OpenAPI</a><a href="/llms.txt">llms.txt</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a></nav>
Data Foundry by Aroqon Data. Source agencies are credited on each dataset page and in every API response; Data Foundry is not affiliated with or endorsed by them.</footer>
</body></html>`;
}

/**
 * Plan cards from the one plan ladder (account.PLANS). Checkout buttons appear
 * only while the sales gate is open; otherwise the cards state that sign-ups
 * are not open, and no button leads to a dead end.
 */
export function planCards(salesOpen: boolean): string {
  return PLAN_IDS.map((id) => {
    const plan = PLANS[id];
    const action = salesOpen
      ? `<form method="post" action="/recalls/checkout"><input type="hidden" name="plan" value="${id}"><button ${id === 'evaluate' ? 'class="secondary"' : ''}>${id === 'evaluate' ? 'Get a free key' : `Subscribe — ${plan.name}`}</button></form>`
      : '<p class="small muted">Sign-ups are not open yet.</p>';
    return `<div class="card"><h3>${plan.name}</h3><div class="price">$${plan.monthlyUsd}<small>/month</small></div>
<p class="muted small">${plan.requests.toLocaleString('en-US')} requests per month across every dataset. Hard stop at the allowance — never an overage bill.</p>
${action}</div>`;
  }).join('');
}

const FDA_RECORD_SHAPE = `{
  "recall_number": "D-0123-2026", "category": "drug", "classification": "II", "status": "Ongoing",
  "firm": { "name": "…", "city": "…", "state": "NJ", "postal_code": "…", "country": "United States" },
  "dates": { "initiated": "2026-08-01", "classified": "2026-09-04", "reported": "2026-09-16", "terminated": null },
  "distribution": { "nationwide_us": true, "international": true, "us_states": ["FL","GA"], "countries": ["PA"], … },
  "quantity": { "items": [{ "value": 403200, "unit": "tablets" }], "total": 403200, "unit": "tablets" },
  "codes": { "gtins": [], "ndcs": ["12345-0678-90"], "lots": ["DJ23254"], "expiration_dates": ["2026-11-30"], … },
  "reason": { "classes": ["SPECIFICATION_FAILURE"], "allergens": [], "pathogens": [] },
  "provenance": { "source_url": "https://api.fda.gov/…", "parser_version": "recall-structuring@1", "raw_sha256": "…", "changed_at": "…" }
}`;

export function docsPage(ctx: PageContext, served: { readonly fda: boolean; readonly products: boolean }): string {
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
    'API documentation — Data Foundry',
    'Endpoints, parameters, authentication and limits for the Data Foundry recall APIs.',
    `<h1>API documentation</h1>
<p class="lede">Base URL <code>${api}</code>. JSON over HTTPS. OpenAPI: <a href="${api}/openapi.json">${api}/openapi.json</a>.${served.fda || served.products ? '' : ' No dataset is available right now.'}</p>
<h2 id="authentication">Authentication</h2>
<p>Send your key as <code>Authorization: Bearer rcl_live_…</code> (or <code>X-API-Key</code>). Every authenticated data request counts toward your monthly allowance; when it is spent, requests return <code>429</code> until the next UTC month or an upgrade. <code>/v1/account</code> and <code>/v1/recalls/stats</code> are not counted.</p>
<h2 id="account">Account endpoints</h2>
<h3>GET /v1/account</h3><p>Your plan, this month's usage and allowance.</p>
<h3>POST /v1/account/rotate-key</h3><p>Revokes the presented key and returns a new one.</p>
<h3>POST /v1/account/billing-portal</h3><p>Returns a Stripe billing-portal URL to upgrade, downgrade or cancel.</p>
${
      served.fda
        ? `<h2 id="fda-recalls">FDA Recall Intelligence endpoints</h2>
<h3 id="recalls-lookup">GET /v1/recalls/lookup?code=…</h3><p>One code, every exact interpretation: GTIN/UPC/UDI (check-digit verified), NDC, lot, serial and model. Returns up to 100 matching recalls, newest first, with <code>matched_on</code>, plus <code>total_matches</code> and <code>truncated</code>; when truncated, page through every match with the <code>/v1/recalls</code> filters listed in <code>complete_results</code>. Lot, serial and model codes ignore internal spaces.</p>
<pre><code>curl "${api}/v1/recalls/lookup?code=05708932072526" -H "Authorization: Bearer $KEY"</code></pre>
<h3 id="recalls-search">GET /v1/recalls</h3><p>Filter and page through recalls, newest report first. Filters combine with AND.</p>
<div class="table-wrap"><table><thead><tr><th>Parameter</th><th>Meaning</th></tr></thead><tbody>${rows.map(([name, text]) => `<tr><td><code>${name}</code></td><td>${text}</td></tr>`).join('')}</tbody></table></div>
<pre><code>curl "${api}/v1/recalls?state=TX&amp;category=food&amp;allergen=peanut&amp;status=Ongoing" -H "Authorization: Bearer $KEY"</code></pre>
<h3 id="recalls-one">GET /v1/recalls/{recall_number}</h3><p>One recall, e.g. <code>/v1/recalls/H-1331-2026?include=raw</code>.</p>
<h3 id="recalls-stats">GET /v1/recalls/stats</h3><p>Public coverage counts and last refresh time.</p>
<h2 id="record-shape">FDA record shape</h2>
<pre><code>${FDA_RECORD_SHAPE}</code></pre>
<p class="notice">Derived FDA fields come from deterministic parsers over FDA prose. They are conservative — a code is only reported when an explicit marker or a valid check digit supports it — but they can be incomplete. The verbatim FDA text is always included for verification. This is not medical or legal advice; do not rely on it for decisions about medical care.</p>`
        : ''
    }
${
      served.products
        ? `<h2 id="product-recalls">Consumer product recall endpoints</h2>
<p>CPSC and Health Canada notices in one schema. Same key and allowance. Dataset page: <a href="/product-recalls">/product-recalls</a>.</p>
<h3 id="product-recalls-lookup">GET /v1/product-recalls/lookup?code=…</h3><p>Every notice that names one model number or UPC/EAN/GTIN (check-digit verified), with <code>matched_on</code>, <code>total_matches</code>, <code>truncated</code> and <code>interpreted_as</code>.</p>
<pre><code>curl "${api}/v1/product-recalls/lookup?code=DXH70CFAVX" -H "Authorization: Bearer $KEY"</code></pre>
<h3 id="product-recalls-search">GET /v1/product-recalls</h3><p>Filters (AND): <code>gtin</code>, <code>model</code>, <code>agency</code> (CPSC|HC), <code>hazard</code>, <code>remedy</code>, <code>facet</code>, <code>category</code>, <code>manufacturer_country</code>, <code>firm</code>, <code>q</code>, <code>linked</code>, <code>from</code>, <code>to</code>, <code>changed_since</code>, <code>limit</code> (≤100), <code>cursor</code>, <code>include=raw</code>. Newest first.</p>
<h3 id="product-recalls-one">GET /v1/product-recalls/{id}</h3><p>One notice, e.g. <code>/v1/product-recalls/cpsc-25203</code> or <code>/v1/product-recalls/hc-77184</code>, with <code>linked_notices</code> (declared citations only). With <code>include=raw</code>, <code>raw</code> is the source record without contact text and images, and <code>raw_redaction</code> names the withheld fields and gives the SHA-256 of <code>raw</code> as returned; <code>provenance.raw_sha256</code> stays the digest of the stored original.</p>
<h3 id="product-recalls-stats">GET /v1/product-recalls/stats</h3><p>Public notice counts per agency, identifier counts, declared links and the last successful sync per source. Not counted.</p>
<p>Full field and enum reference: <a href="/llms-full.txt">llms-full.txt</a> and the <a href="${api}/openapi.json">OpenAPI description</a>.</p>`
        : ''
    }
<h2>Errors</h2>
<p><code>400</code> invalid parameter · <code>401</code> missing/unknown key · <code>403</code> subscription inactive · <code>404</code> not found · <code>429</code> monthly allowance spent · <code>503</code> temporarily unavailable. Errors are <code>{"error": {"code", "message"}}</code>.</p>`,
    { path: '/docs' },
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
<p>Next: <a href="/docs">read the docs</a>. Manage billing any time with <code>POST ${ctx.apiOrigin}/v1/account/billing-portal</code>. Lost key? Email <a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a> from the email address you checked out with; we will verify it against your billing record, revoke the old key and send a new one.</p>`,
    { noindex: true },
  );
}

export function messagePage(ctx: PageContext, title: string, message: string): string {
  return layout(ctx, `${title} — Data Foundry`, title, `<h1>${escapeHtml(title)}</h1><p class="lede">${message}</p><p><a href="/">Back to Data Foundry</a></p>`, { noindex: true });
}

export function termsPage(ctx: PageContext): string {
  return layout(
    ctx,
    'Terms of Service — Data Foundry',
    'Terms of Service for Data Foundry APIs.',
    `<h1>Terms of Service</h1><p class="muted">Effective 2026-09-27. Operator: Aroqon Data (“we”). Contact: <a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a>.</p>
<h3>1. The service</h3><p>We provide API access to datasets we compile and structure from lawfully obtained sources. The FDA Recall Intelligence dataset is derived from U.S. Food and Drug Administration enforcement reports published through openFDA under CC0. The North American Consumer Product Recalls dataset is derived from U.S. Consumer Product Safety Commission recall notices (US Government works) and Health Canada's Recalls and Safety Alerts open data, which contains information licensed under the Open Government Licence – Canada. We are not affiliated with or endorsed by FDA, CPSC, Health Canada or the Government of Canada.</p>
<h3>2. Accounts and keys</h3><p>Keep your API key secret; you are responsible for use of your key. You may rotate it at any time. We may suspend keys used abusively or in breach of these terms.</p>
<h3>3. Plans, billing and cancellation</h3><p>Paid plans are billed monthly in advance in USD by Stripe and renew until cancelled. Each plan includes a monthly request allowance; requests beyond it are refused (HTTP 429) and never billed as overage. You can upgrade, downgrade or cancel from the billing portal; cancellation takes effect at the end of the paid period. Fees are non-refundable except where required by law. Access ends if payment fails and is not resolved.</p>
<h3>4. Acceptable use</h3><p>Do not attempt to circumvent allowances, share keys across unrelated organisations, overload the service, or use it unlawfully. You may use and redistribute the data returned to you, including commercially, with attribution to the source agency where practicable (FDA/openFDA; CPSC; for Health Canada data, the statement “Contains information licensed under the Open Government Licence – Canada”).</p>
<h3>5. No warranty</h3><p>The data is provided “as is”. Derived fields are produced by automated parsers from agency text and may be incomplete or inaccurate; the verbatim source record is provided for verification. The service is not medical, legal or regulatory advice and must not be the sole basis for decisions about medical care, product safety or compliance. Always confirm against the official agency recall notice.</p>
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
