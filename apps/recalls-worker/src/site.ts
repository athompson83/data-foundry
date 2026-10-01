/**
 * The Data Foundry homepage (which is also the dataset catalog) and the one
 * product-page template every dataset uses. Everything is server-rendered;
 * the only script (copy buttons) is progressive enhancement.
 *
 * Coverage and freshness shown here are read from the same public stats the
 * API serves (edge-cached), never hardcoded; a configured schedule is stated
 * as a schedule, next to the last sync that actually succeeded.
 */

import type { DatasetEntry } from './catalog.js';
import { escapeHtml, layout, planCards, type PageContext } from './pages.js';
import { catalogJsonLd, DATASET_JSON_LD } from './seo.js';

/** Public coverage for one dataset, from its stats endpoint. */
export interface Coverage {
  readonly records: number;
  /** e.g. "food 29,415 · drug 17,975 · device 39,969". */
  readonly breakdown: string;
  readonly latestRecord: string | null;
  readonly lastSuccessfulSync: string | null;
}

export interface SiteState {
  readonly datasets: ReadonlyArray<{ readonly entry: DatasetEntry; readonly coverage: Coverage | null }>;
  readonly salesOpen: boolean;
}

const number = (value: number): string => value.toLocaleString('en-US');

function when(iso: string | null): string {
  if (!iso) return 'not yet recorded';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function copyButton(target: string, label = 'Copy'): string {
  // Hidden until site.js runs, so without JavaScript there is no control that does nothing.
  return `<button type="button" class="copy" data-copy="${target}" hidden>${label}</button>`;
}

function codeWindow(id: string, caption: string, code: string, extraClass = ''): string {
  return `<div class="window"><div class="bar"><span>${caption}</span>${copyButton(id)}</div><pre class="${extraClass}" id="${id}" tabindex="0"><code>${escapeHtml(code)}</code></pre></div>`;
}

function accessLine(salesOpen: boolean): string {
  return salesOpen
    ? '<span class="badge">Available</span><span class="small muted">Free Evaluate key or monthly plan, sold directly on this site.</span>'
    : '<span class="badge warn">Sign-ups not open</span><span class="small muted">Documentation and samples are public; keys are not being issued yet.</span>';
}

function coverageFacts(coverage: Coverage | null): string {
  if (!coverage) return '<p class="small muted">Coverage figures are temporarily unavailable.</p>';
  return `<dl class="facts"><dt>Records</dt><dd>${number(coverage.records)}${coverage.breakdown ? ` <span class="muted small">(${escapeHtml(coverage.breakdown)})</span>` : ''}</dd>
<dt>Newest record</dt><dd>${escapeHtml(coverage.latestRecord ?? 'n/a')}</dd>
<dt>Last successful refresh</dt><dd>${escapeHtml(when(coverage.lastSuccessfulSync))}</dd></dl>`;
}

/** An excerpt of the real sample: whole fields selected from it, values untouched. */
function heroExcerpt(entry: DatasetEntry): string {
  const data = (JSON.parse(entry.sample.response) as { data: Record<string, unknown> }).data;
  const pick = (keys: readonly string[]) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
  return JSON.stringify({ data: pick(entry.sample.heroFields) }, null, 2);
}

export function homePage(ctx: PageContext, state: SiteState): string {
  // Showcase a sample captured from the live API when one is published; label a parser-output sample as such.
  const first = state.datasets.find(({ entry }) => entry.sample.origin === 'live-api') ?? state.datasets[0];
  const live = first?.entry.sample.origin === 'live-api';
  const hero = first
    ? `<div>${codeWindow('hero-sample', `Excerpt · snapshot of <code>GET ${escapeHtml(first.entry.sample.path)}</code>`, heroExcerpt(first.entry), 'response')}
<p class="small muted">${live ? 'A real response captured' : 'The production parser’s output, snapshot of'} ${escapeHtml(first.entry.sample.capturedOn)}, showing selected fields. <a href="#inspect">See the full sample</a>.</p></div>`
    : '';
  const cards = state.datasets
    .map(
      ({ entry, coverage }) => `<li class="catalog-row"><div><h3><a href="${entry.path}">${escapeHtml(entry.name)}</a></h3>
<p class="tags"><span class="tag">${escapeHtml(entry.domain)}</span><span class="tag">${escapeHtml(entry.recordType)}</span><span class="tag">${escapeHtml(entry.region)}</span></p>
<p class="small">${escapeHtml(entry.summary)}</p></div>
<dl class="catalog-meta"><div><dt>Records</dt><dd>${coverage ? number(coverage.records) : 'unavailable'}</dd></div><div><dt>Sources</dt><dd>${entry.sources.map((source) => escapeHtml(source.short)).join(', ')}</dd></div><div><dt>Last refresh</dt><dd>${coverage ? escapeHtml(when(coverage.lastSuccessfulSync)) : 'unavailable'}</dd></div></dl></li>`,
    )
    .join('');
  const inspect = first
    ? `<h2 id="inspect">Inspect the data</h2>
<p class="lede">${live ? `A real ${escapeHtml(first.entry.name)} response and the request that returns it.` : `A ${escapeHtml(first.entry.name)} record as the API returns it, and the request for it.`} ${escapeHtml(first.entry.sample.note)}</p>
<div class="grid" style="grid-template-columns:minmax(0,1fr)">${codeWindow('inspect-request', 'Request', first.entry.sample.request)}
${codeWindow('inspect-response', `${live ? 'Response · snapshot captured' : 'Parser output · snapshot of'} ${escapeHtml(first.entry.sample.capturedOn)}`, first.entry.sample.response, 'response')}</div>
<p class="small muted">Replace <code>$DATA_FOUNDRY_KEY</code> with your own key. Live responses carry the same fields plus an <code>attribution</code> object; see the <a href="/docs">API docs</a> and <a href="${ctx.apiOrigin}/openapi.json">OpenAPI description</a>.</p>`
    : '';
  const multiAgency = state.datasets.some(({ entry }) => entry.key === 'product-recalls');
  const faq: Array<[string, string]> = [
    [
      'What does each dataset cover, and how current is it?',
      `Each dataset page shows live record counts, the newest record and the last refresh that actually succeeded. ${state.datasets.map(({ entry }) => `${escapeHtml(entry.name)}: ${escapeHtml(entry.refreshSchedule.toLowerCase())}`).join(' ')} How recent the newest record is depends on when the source agency publishes.`,
    ],
    ['How do I authenticate?', 'Send your key as <code>Authorization: Bearer rcl_live_…</code> (or <code>X-API-Key</code>). Keys are shown once at checkout and stored only as hashes; rotate one any time with <code>POST /v1/account/rotate-key</code>.'],
    ['What happens when I reach my monthly allowance?', 'Requests return <code>429 allowance_exhausted</code> until the next UTC month or an upgrade. There are no overage charges. <code>GET /v1/account</code> shows usage; the stats endpoints are free.'],
    ['Does one key cover every dataset?', 'Yes. Every plan’s monthly allowance applies across all the datasets listed here.'],
    ['What may I do with the data?', 'You may use and redistribute the data returned to you, including commercially, with attribution to the source agency where practicable (see each dataset page and the <a href="/terms">Terms</a>). Data Foundry is not affiliated with or endorsed by any source agency, and the data is not medical, legal or safety advice.'],
    ['Where can I buy access?', state.salesOpen ? 'Directly on this site: plans are monthly subscriptions billed by Stripe, and you can upgrade, downgrade or cancel from the billing portal. Marketplace listings are not available yet.' : 'Sign-ups are not open yet. Marketplace listings are not available yet either.'],
  ];
  const body = `<section class="hero"><div><p class="eyebrow">Data Foundry</p><h1>Clean data for applications and AI agents.</h1>
<p class="lede">Government agencies publish recalls as prose. We turn them into exact fields — lot numbers, UPC/GTIN, model numbers, distribution states, hazards${multiAgency ? ', US–Canada links' : ''} — served as JSON, with the source record behind every answer.</p>
<div class="actions"><a class="button" href="#datasets">Explore datasets</a><a class="button secondary" href="/docs">View API docs</a></div></div>${hero}</section>
<h2 id="datasets">Datasets</h2><p class="lede">Every dataset listed here is live on the API. One key covers all of them.</p>
<p>${accessLine(state.salesOpen)}</p>
${cards ? `<div class="catalog-row catalog-head" aria-hidden="true"><span>Dataset</span><div class="catalog-meta"><span>Records</span><span>Sources</span><span>Last refresh</span></div></div><ul class="catalog">${cards}</ul>` : '<p class="notice">No dataset is available right now.</p>'}
${inspect}
<h2>Why use Data Foundry instead of the raw source</h2>
<div class="grid"><div class="card"><h3>Fields, not prose</h3><p class="small muted">Lots, codes, states, quantities, hazards and remedies are parsed out of free text by deterministic parsers — no model guesses.</p></div>
<div class="card"><h3>Exact identifiers</h3><p class="small muted">UPC/EAN/GTIN are check-digit verified and normalised to GTIN-14; NDCs are normalised; one lookup tries every exact reading of a code.</p></div>
<div class="card"><h3>Provenance on every record</h3><p class="small muted">Each record carries its source URL, parser version and the SHA-256 of the stored source record. <code>include=raw</code> returns that record, with any contact details and images withheld and named in <code>raw_redaction</code>.</p></div>
${multiAgency ? '<div class="card"><h3>One schema across agencies</h3><p class="small muted">CPSC and Health Canada notices share one taxonomy, and a US notice links to its Canadian counterpart where CPSC cites it.</p></div>' : ''}
<div class="card"><h3>Predictable billing</h3><p class="small muted">Monthly plans with a hard stop at the allowance; never an overage bill.</p></div></div>
<h2>How access works</h2>
<ol class="steps"><li><strong>Pick a dataset</strong><br><span class="small muted">Read its page and the <a href="/docs">API docs</a>. Coverage stats are public.</span></li>
<li><strong>Get a key</strong><br><span class="small muted">${state.salesOpen ? 'Choose the free Evaluate plan or a paid plan below. Your key is shown once, right after checkout.' : 'Sign-ups are not open yet; the docs and samples are public meanwhile.'}</span></li>
<li><strong>Make a request</strong><br><span class="small muted">Send the key as a Bearer token to <code>${escapeHtml(ctx.apiOrigin)}</code>.</span></li>
<li><strong>Track usage</strong><br><span class="small muted"><code>GET /v1/account</code> shows this month’s usage; the billing portal changes plans.</span></li></ol>
<h2 id="pricing">Pricing</h2><p class="lede">Monthly plans, billed by Stripe. One key works across every dataset.</p>
<div class="grid">${planCards(state.salesOpen)}</div>
<h2>Questions</h2>${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}`;
  return layout(ctx, 'Data Foundry — clean data for applications and AI agents', 'Structured, provenance-linked recall data for software and AI agents: exact identifiers, distribution, hazards and source records, over a JSON API.', body, {
    path: '/',
    jsonLd: [catalogJsonLd(ctx, state.datasets.map(({ entry }) => entry.key))],
    scripts: true,
  });
}

export function datasetPage(ctx: PageContext, entry: DatasetEntry, coverage: Coverage | null, salesOpen: boolean): string {
  const body = `<p class="eyebrow">${escapeHtml(entry.name)}</p><h1>${escapeHtml(entry.headline)}</h1>
<p class="lede">${escapeHtml(entry.lede)}</p>
<p>${accessLine(salesOpen)}</p>
<div class="actions"><a class="button" href="#pricing">${salesOpen ? 'Get a key' : 'See plans'}</a><a class="button secondary" href="/docs">Read the API docs</a></div>
<h2>What you can do with it</h2><ul>${entry.useCases.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
<h2>Coverage and freshness</h2>${coverageFacts(coverage)}
<p class="small muted">Schedule: ${escapeHtml(entry.refreshSchedule)} The “last successful refresh” above is when a sync last completed, not the schedule. Live figures: <a href="${ctx.apiOrigin}${entry.statsPath}"><code>GET ${escapeHtml(entry.statsPath)}</code></a> (no key needed).</p>
<h2>First request</h2>${codeWindow('first-request', 'Request', entry.sample.request)}
<p class="small muted">Replace <code>$DATA_FOUNDRY_KEY</code> with your key.</p>
<h2>${entry.sample.origin === 'live-api' ? 'Sample response' : 'Sample record'}</h2><p class="small muted">${escapeHtml(entry.sample.note)} Captured ${escapeHtml(entry.sample.capturedOn)}.</p>
${codeWindow('sample-response', `${entry.sample.origin === 'live-api' ? 'Response · snapshot captured' : 'Parser output · snapshot of'} ${escapeHtml(entry.sample.capturedOn)}`, entry.sample.response, 'response')}
<h2>Key fields</h2><div class="table-wrap"><table><thead><tr><th scope="col">Field</th><th scope="col">What it holds</th></tr></thead><tbody>${entry.fields.map((field) => `<tr><td><code>${escapeHtml(field.name)}</code></td><td>${escapeHtml(field.meaning)}</td></tr>`).join('')}</tbody></table></div>
<h2>Endpoints</h2><div class="table-wrap"><table><thead><tr><th scope="col">Endpoint</th><th scope="col">Returns</th></tr></thead><tbody>${entry.endpoints.map((endpoint) => `<tr><td><a href="${endpoint.docs}"><code>${endpoint.method} ${escapeHtml(endpoint.path)}</code></a></td><td>${escapeHtml(endpoint.summary)}</td></tr>`).join('')}</tbody></table></div>
<p class="small muted">Full parameters and errors: <a href="/docs">API docs</a> · <a href="${ctx.apiOrigin}/openapi.json">OpenAPI 3.1</a> · every record also has a public page: <a href="${entry.browsePath}">browse by year</a>.</p>
<h2>Sources and limitations</h2><ul>${entry.sources.map((source) => `<li><a href="${source.url}">${escapeHtml(source.name)}</a> <span class="muted small">(${escapeHtml(source.terms)})</span></li>`).join('')}</ul>
<ul>${entry.limitations.map((item) => `<li class="small">${escapeHtml(item)}</li>`).join('')}</ul>
<h2 id="pricing">Pricing and access</h2><p class="lede">Monthly plans, billed by Stripe. One key covers every Data Foundry dataset.</p>
<div class="grid">${planCards(salesOpen)}</div>
<p class="small muted">${escapeHtml(entry.attribution)}</p>`;
  return layout(ctx, `${entry.name} API — Data Foundry`, entry.summary, body, { path: entry.path, jsonLd: [DATASET_JSON_LD[entry.key](ctx)], scripts: true });
}

/** Progressive enhancement only: reveals and wires the copy buttons. */
export const SITE_JS = `document.querySelectorAll('button[data-copy]').forEach(function(b){b.hidden=false});
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button[data-copy]');if(!b)return;var t=document.getElementById(b.getAttribute('data-copy'));if(!t||!navigator.clipboard)return;
navigator.clipboard.writeText(t.innerText).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)},function(){b.textContent='Select the text to copy'})});`;
