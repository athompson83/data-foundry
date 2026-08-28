/**
 * Page renderers. Each one: read through a surface-bound query model (rule 5), build the
 * body HTML, measure its own real word count, evaluate the doc-07 quality
 * gate against real signals, then hand `robots` + `structuredData` +
 * `bodyHtml` to `layout()`. No page decides its own indexability by fiat —
 * `gates.ts` does, from what was actually measured.
 */
import type { Entity, VerticalId } from '@data-foundry/canonical-schema';
import type { EntityView, SurfaceQueryModel } from '@data-foundry/query-model';
import type { VerticalDeployment, WebDeployment } from './composition.js';
import {
  computeEntitySignals,
  computeVerticalDatasetSignals,
  countContentWords,
  evaluateGate,
  type GateSignals,
} from './gates.js';
import { escapeAttr, escapeHtml, layout, renderList } from './render.js';
import {
  fillTemplate,
  gateFor,
  pageClassForEntityType,
  type PageClass,
  type SeoConfig,
} from './seo.js';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from './concurrency.js';

export function entityHref(vertical: VerticalDeployment, entity: Entity): string | null {
  const pageClass = pageClassForEntityType(vertical.runtime.seo, entity.entity_type);
  if (pageClass === null) return null;
  return fillTemplate(pageClass.path, { canonical_slug: entity.canonical_slug });
}

function robotsFor(seo: SeoConfig, passed: boolean): string {
  return passed ? 'index,follow' : seo.on_gate_failure.robots;
}

function combinedFailures(...groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())];
}

function coverageNotice(seo: SeoConfig, failures: readonly string[]): string {
  if (!seo.on_gate_failure.show_coverage_notice || failures.length === 0) return '';
  const template =
    seo.on_gate_failure.notice_template ?? 'This page is incomplete: {missing_count} check(s) unmet.';
  const text = template
    .replace('{missing_count}', String(failures.length))
    .replace('{critical_count}', String(failures.length));
  return `<div class="notice"><p>${escapeHtml(text)}</p><ul>${failures
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join('')}</ul></div>`;
}

/**
 * Emit structured data only when the vertical can substantiate every field it
 * declared mandatory. Missing legal/provenance metadata is not filled with a
 * convenient guess merely to obtain a rich result.
 */
function datasetStructuredData(
  vertical: VerticalDeployment,
  pageClass: PageClass | null,
): Readonly<Record<string, unknown>> | undefined {
  if (pageClass?.structured_data !== 'Dataset') return undefined;
  const spec = vertical.runtime.seo.structured_data['dataset_page'];
  if (spec?.type !== 'Dataset') return undefined;

  const candidate: Readonly<Record<string, unknown>> = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: vertical.runtime.vertical_name,
    description: `Evidence-backed ${vertical.runtime.vertical_name} data.`,
  };
  const complete = (spec.required_fields ?? []).every((field) => {
    const value = candidate[field];
    return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
  });
  return complete ? candidate : undefined;
}

/** The parent site: every industry this deployment serves (ADR-0011). */
export function renderParentIndex(deployment: WebDeployment): string {
  const items = [...deployment.verticals.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((v) => {
      const href = escapeAttr(v.runtime.seo.url_prefix);
      return `<li><a href="${href}">${escapeHtml(v.runtime.vertical_name)}</a> — <span>${escapeHtml(v.runtime.vertical_status)}</span></li>`;
    });

  const body = `
<h1>Data Foundry</h1>
<p>Evidence-backed data, by industry. Every published value cites the source it came from and the rule that selected it — see <a href="https://github.com/athompson83/data-foundry/blob/main/DATA_RIGHTS.md">licensing and data rights</a> for what that does and does not license.</p>
<h2>Industries</h2>
${items.length === 0 ? '<p>No industry is currently serving data from this deployment.</p>' : renderList(items)}
<p>Adding an industry is a configuration change, not a fork — see <a href="https://github.com/athompson83/data-foundry/blob/main/docs/adding-a-new-industry.md">adding a new industry</a>.</p>`;

  return layout({
    title: 'Data Foundry — evidence-backed industry data',
    description:
      'A repeatable data foundry: evidence-backed, source-cited knowledge products, one dataset per industry.',
    canonicalUrl: `${deployment.publicOrigin}/`,
    robots: 'index,follow',
    bodyHtml: body,
  });
}

interface RenderedPage {
  readonly html: string;
  readonly status: number;
}

export async function renderDatasetLanding(
  vertical: VerticalDeployment,
  publicOrigin: string,
): Promise<RenderedPage> {
  const seo = vertical.runtime.seo;
  const pageClass = seo.page_classes.find((pc) => pc.id === 'dataset_landing') ?? null;
  const canonicalUrl = `${publicOrigin}${seo.url_prefix}`;

  const byType = await Promise.all(
    vertical.runtime.entity_types.map(async (entityType) => {
      const result = await vertical.publicQueryModel.search({
        vertical_id: vertical.verticalId as never,
        entity_type: entityType as never,
        limit: 1,
      });
      const meta = vertical.runtime.entity_type_meta[entityType];
      return { entityType, count: result.total, label: meta?.label_plural ?? entityType };
    }),
  );

  const browseLinks = byType
    .map((t) => {
      const href = `${seo.url_prefix}/search?type=${encodeURIComponent(t.entityType)}`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(t.label)}</a> (${t.count})</li>`;
    })
    .join('');

  let failures: readonly string[] = [];
  if (pageClass !== null) {
    const gate = gateFor(seo, pageClass.quality_gate);
    if (gate !== null) {
      const [publicSignals, indexSignals] = await Promise.all([
        computeVerticalDatasetSignals(vertical.publicQueryModel, vertical.verticalId),
        computeVerticalDatasetSignals(vertical.searchIndexQueryModel, vertical.verticalId),
      ]);
      failures = combinedFailures(
        evaluateGate(gate, publicSignals).failures,
        evaluateGate(gate, indexSignals).failures,
      );
    }
  }
  const passed = failures.length === 0;

  const body = `
<h1>${escapeHtml(vertical.runtime.vertical_name)}</h1>
<p>${escapeHtml(vertical.runtime.vertical_status)} vertical. Browse by type, or <a href="${escapeHtml(`${seo.url_prefix}/search`)}">search all ${escapeHtml(vertical.runtime.vertical_name)} data</a>.</p>
${coverageNotice(seo, failures)}
<h2>Browse</h2>
<ul>${browseLinks}</ul>
<p><a href="${escapeHtml(`${seo.url_prefix}/docs`)}">API &amp; MCP access</a> for programmatic and agent queries.</p>`;

  const html = layout({
    title: pageClass?.title ?? vertical.runtime.vertical_name,
    description: `Evidence-backed ${vertical.runtime.vertical_name} data: every value cites its source.`,
    canonicalUrl,
    robots: robotsFor(seo, passed),
    structuredData: datasetStructuredData(vertical, pageClass),
    bodyHtml: body,
    breadcrumbs: [
      { label: 'Data Foundry', href: '/' },
      { label: vertical.runtime.vertical_name, href: seo.url_prefix },
    ],
  });
  return { html, status: 200 };
}

function safeEvidenceHref(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

async function factsTable(
  vertical: VerticalDeployment,
  entityId: Entity['id'],
  facts: Awaited<ReturnType<SurfaceQueryModel['canonicalFacts']>>,
  criticalProperties: readonly string[],
): Promise<string> {
  const published = facts.filter((fact) => fact.fact_id !== null);
  const explanations = await mapWithConcurrency(published, DEFAULT_CONCURRENCY, (fact) =>
    vertical.publicQueryModel.explainFact(entityId, fact.property),
  );
  const rows = published
    .map((f, index) => {
      const critical = criticalProperties.includes(f.property) ? ' *' : '';
      const value = f.value === null ? '—' : String(f.value);
      const conflict = f.unresolved_conflict ? ' <span title="disputed value">⚠</span>' : '';
      const explanation = explanations[index];
      const selected =
        explanation?.selected?.fact_id === f.fact_id ? explanation.selected : null;
      const attributions = selected?.attributions ?? [];
      const evidenceItems = attributions
        .map((attribution) => {
          const href = safeEvidenceHref(attribution.artifact_url);
          const artifact =
            href === null
              ? ''
              : ` — <a href="${escapeAttr(href)}" rel="nofollow noreferrer">source artifact</a>`;
          return `<li>${escapeHtml(attribution.publisher)} (${escapeHtml(attribution.domain)}, ${escapeHtml(attribution.source_type)}) — ${escapeHtml(attribution.locator)}${artifact}</li>`;
        })
        .join('');
      const evidence = `<details class="evidence"><summary>Fact ${escapeHtml(String(f.fact_id))}</summary><p>Selection: ${escapeHtml(explanation?.reason ?? f.reason)}</p>${evidenceItems === '' ? '<p>No surface-authorized attribution is available.</p>' : `<ul>${evidenceItems}</ul>`}</details>`;
      return `<tr><th scope="row">${escapeHtml(f.property)}${critical}</th><td>${escapeHtml(value)}${f.unit ? ` ${escapeHtml(f.unit)}` : ''}${conflict}</td><td>${evidence}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Property</th><th>Value</th><th>Source(s)</th></tr></thead><tbody>${rows}</tbody></table>
<p class="evidence">* critical property, required for this page to be indexable.</p>`;
}

export async function renderEntityDetail(
  vertical: VerticalDeployment,
  entityView: EntityView,
  pageClass: PageClass,
  publicOrigin: string,
  now: Date,
): Promise<RenderedPage> {
  const seo = vertical.runtime.seo;
  const entity = entityView.entity;
  const critical = vertical.runtime.critical_properties[entity.entity_type] ?? [];
  const facts = await vertical.publicQueryModel.canonicalFacts(entity.id);

  const traversal = await vertical.publicQueryModel.relationships({
    entity_id: entity.id,
    direction: 'both',
    depth: 1,
    limit: 50,
  });
  const relatedLinks = traversal.edges
    .map((edge) => {
      const href = entityHref(vertical, edge.neighbor);
      if (href === null) return null;
      return `<li>${escapeHtml(edge.relationship.predicate)} — <a href="${escapeHtml(href)}">${escapeHtml(edge.neighbor.canonical_name)}</a></li>`;
    })
    .filter((x): x is string => x !== null);

  const title = fillTemplate(pageClass.title, { canonical_name: entity.canonical_name });
  const canonicalUrl = `${publicOrigin}${fillTemplate(pageClass.path, { canonical_slug: entity.canonical_slug })}`;

  const evidenceTable = await factsTable(vertical, entity.id, facts, critical);
  const contentBody = `
<h1>${escapeHtml(entity.canonical_name)}</h1>
<p class="evidence">Quality score ${entity.quality_score.toFixed(2)} · last verified ${entity.last_verified_at ?? 'never'}</p>
${evidenceTable}
${relatedLinks.length > 0 ? `<h2>Related</h2><ul>${relatedLinks.join('')}</ul>` : ''}`;

  const contentWords = countContentWords(contentBody.replace(/<[^>]+>/g, ' '));

  let failures: readonly string[] = [];
  const gate = gateFor(seo, pageClass.quality_gate);
  if (gate !== null) {
    const publicBase = await computeEntitySignals(
      vertical.publicQueryModel,
      entity.id,
      entity.quality_score,
      entity.updated_at,
      critical,
      {},
      now,
    );
    const publicSignals: GateSignals = { ...publicBase, unique_content_words: contentWords };
    if (gate.min_related_entities !== undefined) {
      (publicSignals as { related_entities?: number }).related_entities = traversal.edges.length;
    }
    const publicFailures = evaluateGate(gate, publicSignals).failures;

    const indexView = await vertical.searchIndexQueryModel.getEntity(entity.id);
    if (indexView === null) {
      failures = combinedFailures(publicFailures, [
        'SEARCH_INDEX surface authorization could not be established.',
      ]);
    } else {
      const [indexBase, indexTraversal] = await Promise.all([
        computeEntitySignals(
          vertical.searchIndexQueryModel,
          entity.id,
          entity.quality_score,
          entity.updated_at,
          critical,
          {},
          now,
        ),
        gate.min_related_entities === undefined
          ? Promise.resolve(null)
          : vertical.searchIndexQueryModel.relationships({
              entity_id: entity.id,
              direction: 'both',
              depth: 1,
              limit: 50,
            }),
      ]);
      const indexSignals: GateSignals = { ...indexBase, unique_content_words: contentWords };
      if (indexTraversal !== null) {
        (indexSignals as { related_entities?: number }).related_entities =
          indexTraversal.edges.length;
      }
      failures = combinedFailures(publicFailures, evaluateGate(gate, indexSignals).failures);
    }
  }
  const passed = failures.length === 0;

  const body = `${coverageNotice(seo, failures)}${contentBody}`;

  const html = layout({
    title,
    description: `${entity.canonical_name} — evidence-backed specifications, every value cited to its source.`,
    canonicalUrl,
    robots: robotsFor(seo, passed),
    bodyHtml: body,
    breadcrumbs: [
      { label: 'Data Foundry', href: '/' },
      { label: vertical.runtime.vertical_name, href: seo.url_prefix },
      { label: entity.canonical_name, href: canonicalUrl.slice(publicOrigin.length) },
    ],
  });
  return { html, status: 200 };
}

export async function renderReplacement(
  vertical: VerticalDeployment,
  entityView: EntityView,
  pageClass: PageClass,
  publicOrigin: string,
  now: Date,
): Promise<RenderedPage> {
  const seo = vertical.runtime.seo;
  const entity = entityView.entity;
  const traversal = await vertical.publicQueryModel.relationships({
    entity_id: entity.id,
    predicate: 'supersedes' as never,
    direction: 'both',
    depth: 1,
    limit: 10,
  });

  const replacements = traversal.edges.filter((e) => e.direction === 'in');
  const title = fillTemplate(pageClass.title, { canonical_name: entity.canonical_name });
  const canonicalUrl = `${publicOrigin}${fillTemplate(pageClass.path, { canonical_slug: entity.canonical_slug })}`;

  const list = replacements
    .map((edge) => {
      const href = entityHref(vertical, edge.neighbor);
      return href === null
        ? `<li>${escapeHtml(edge.neighbor.canonical_name)}</li>`
        : `<li><a href="${escapeHtml(href)}">${escapeHtml(edge.neighbor.canonical_name)}</a></li>`;
    })
    .join('');

  const contentBody = `
<h1>${escapeHtml(title)}</h1>
${replacements.length === 0 ? '<p>No recorded replacement.</p>' : `<ul>${list}</ul>`}`;
  const contentWords = countContentWords(contentBody.replace(/<[^>]+>/g, ' '));

  let failures: readonly string[] = [];
  const gate = gateFor(seo, pageClass.quality_gate);
  if (gate !== null) {
    let terminalIndexable = false;
    if (replacements.length > 0) {
      const target = replacements[0]!.neighbor;
      const targetPageClass = pageClassForEntityType(seo, target.entity_type);
      if (targetPageClass !== null) {
        const targetGate = gateFor(seo, targetPageClass.quality_gate);
        if (targetGate !== null) {
          const targetView = await vertical.publicQueryModel.getEntity(target.id);
          if (targetView !== null) {
            const targetCritical = vertical.runtime.critical_properties[target.entity_type] ?? [];
            const targetSignals = await computeEntitySignals(
              vertical.publicQueryModel,
              target.id,
              target.quality_score,
              target.updated_at,
              targetCritical,
              {},
              now,
            );
            // Content words are not re-rendered for the target here — that
            // would recurse into a full page render. `false` is the honest,
            // fail-closed answer when that dimension cannot be checked
            // without doing so; see gates.ts's UNMEASURED convention.
            terminalIndexable = evaluateGate(targetGate, targetSignals).passed;
          }
        }
      }
    }
    // This page's substance is the relationship traversal, not the entity's
    // own facts — its evidence_coverage reads relationships.coverage from the
    // surface-authorized edge evidence, rather than an unrestricted provenance
    // aggregate or a constant assertion.
    const signals: GateSignals = {
      supersession_edges: replacements.length,
      terminal_model_indexable: terminalIndexable,
      unique_content_words: contentWords,
      evidence_coverage:
        traversal.edges.length === 0
          ? 1
          : traversal.edges.filter((edge) => edge.evidence_count > 0).length /
            traversal.edges.length,
    };
    failures = evaluateGate(gate, signals).failures;
  }
  const passed = failures.length === 0;

  const html = layout({
    title,
    description: `What replaces ${entity.canonical_name}, with evidence.`,
    canonicalUrl,
    robots: robotsFor(seo, passed),
    bodyHtml: `${coverageNotice(seo, failures)}${contentBody}`,
    breadcrumbs: [
      { label: 'Data Foundry', href: '/' },
      { label: vertical.runtime.vertical_name, href: seo.url_prefix },
      { label: entity.canonical_name, href: entityHref(vertical, entity) ?? seo.url_prefix },
      { label: 'Replacements', href: canonicalUrl.slice(publicOrigin.length) },
    ],
  });
  return { html, status: 200 };
}

export function renderDocs(vertical: VerticalDeployment, publicOrigin: string): RenderedPage {
  const seo = vertical.runtime.seo;
  const canonicalUrl = `${publicOrigin}${seo.url_prefix}/docs`;
  const body = `
<h1>${escapeHtml(vertical.runtime.vertical_name)} — API &amp; MCP access</h1>
<p>This page is free and public. Programmatic access is metered and requires an API key — see <a href="https://github.com/athompson83/data-foundry/blob/main/DATA_RIGHTS.md">data rights and licensing</a> for what an export or API response does and does not license.</p>
<h2>REST</h2>
<p>Read-only, versioned at <code>/v1</code>. Full contract: <code>GET /v1</code> on your deployment's metered API host.</p>
<h2>MCP</h2>
<p>Tool contract over the same canonical query layer this site reads — see <code>apps/mcp</code> in the repository.</p>
<h2>llms.txt</h2>
<p><a href="${escapeHtml(`${seo.url_prefix}/llms.txt`)}">${escapeHtml(`${seo.url_prefix}/llms.txt`)}</a> — machine discovery for agents, including which prompts route to which tool.</p>`;

  const html = layout({
    title: `${vertical.runtime.vertical_name} — API and MCP docs`,
    description: `How to query ${vertical.runtime.vertical_name} data programmatically.`,
    canonicalUrl,
    robots: 'index,follow',
    bodyHtml: body,
    breadcrumbs: [
      { label: 'Data Foundry', href: '/' },
      { label: vertical.runtime.vertical_name, href: seo.url_prefix },
      { label: 'Docs', href: canonicalUrl.slice(publicOrigin.length) },
    ],
  });
  return { html, status: 200 };
}

export async function renderSearch(
  vertical: VerticalDeployment,
  publicOrigin: string,
  query: { readonly q?: string; readonly type?: string },
): Promise<RenderedPage> {
  const seo = vertical.runtime.seo;
  const hasQuery = (query.q !== undefined && query.q.trim() !== '') || query.type !== undefined;
  const canonicalUrl = `${publicOrigin}${seo.url_prefix}/search`;

  const typeOptions = vertical.runtime.entity_types
    .map((t) => {
      const meta = vertical.runtime.entity_type_meta[t];
      const selected = query.type === t ? ' selected' : '';
      return `<option value="${escapeHtml(t)}"${selected}>${escapeHtml(meta?.label_plural ?? t)}</option>`;
    })
    .join('');

  const form = `
<form class="search" method="get" action="${escapeHtml(`${seo.url_prefix}/search`)}">
<label for="q">Search ${escapeHtml(vertical.runtime.vertical_name)}</label><br>
<input type="search" id="q" name="q" value="${escapeHtml(query.q ?? '')}" placeholder="model number, manufacturer, certification…">
<select name="type"><option value="">All types</option>${typeOptions}</select>
<button type="submit">Search</button>
</form>`;

  let resultsHtml = '';
  if (hasQuery) {
    const result = await vertical.publicQueryModel.search({
      vertical_id: vertical.verticalId as never,
      ...(query.q ? { text: query.q } : {}),
      ...(query.type ? { entity_type: query.type as never } : {}),
      limit: 50,
    });
    const rows = result.hits
      .map((hit) => {
        const href = entityHref(vertical, hit.entity);
        const link = href === null ? escapeHtml(hit.entity.canonical_name) : `<a href="${escapeHtml(href)}">${escapeHtml(hit.entity.canonical_name)}</a>`;
        return `<li>${link} <span class="evidence">(${escapeHtml(hit.entity.entity_type)})</span></li>`;
      })
      .join('');
    resultsHtml = `<h2>${result.total} result${result.total === 1 ? '' : 's'}</h2>${result.hits.length === 0 ? '<p>No matches.</p>' : `<ul>${rows}</ul>`}`;
  }

  const body = `<h1>Search ${escapeHtml(vertical.runtime.vertical_name)}</h1>${form}${resultsHtml}`;

  const html = layout({
    title: hasQuery ? `Search results — ${vertical.runtime.vertical_name}` : `Search ${vertical.runtime.vertical_name}`,
    description: `Search evidence-backed ${vertical.runtime.vertical_name} data.`,
    canonicalUrl,
    // A parametrized result view is a generated, combinatorial page — the same
    // reasoning `seo.yaml` applies to `filtered_collection`. The bare form
    // (no query) is the indexable wayfinding hub; a specific query is not.
    robots: hasQuery ? 'noindex,follow' : 'index,follow',
    bodyHtml: body,
    breadcrumbs: [
      { label: 'Data Foundry', href: '/' },
      { label: vertical.runtime.vertical_name, href: seo.url_prefix },
      { label: 'Search', href: canonicalUrl.slice(publicOrigin.length) },
    ],
  });
  return { html, status: 200 };
}

export function render404(publicOrigin: string): RenderedPage {
  const html = layout({
    title: 'Not found — Data Foundry',
    description: 'This page does not exist.',
    canonicalUrl: `${publicOrigin}/`,
    robots: 'noindex,nofollow',
    bodyHtml: '<h1>Not found</h1><p>Nothing is published at this address. <a href="/">Back to all industries.</a></p>',
  });
  return { html, status: 404 };
}
