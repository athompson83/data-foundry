/**
 * Page renderers. Each one: read through a surface-bound query model (rule 5), build the
 * body HTML, measure its own real word count, evaluate the doc-07 quality
 * gate against real signals, then hand `robots` + `structuredData` +
 * `bodyHtml` to `layout()`. No page decides its own indexability by fiat —
 * `gates.ts` does, from what was actually measured.
 */
import type { Entity } from '@data-foundry/canonical-schema';
import type {
  CanonicalFactView,
  EntityView,
  RelationshipEdge,
  SurfaceFactExplanation,
} from '@data-foundry/query-model';
import type { RequestWebDeployment, VerticalDeployment } from './composition.js';
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
import {
  datasetRenderedCountsCovered,
  loadEntityContentIntersection,
  relationshipTraversalEquivalent,
  sameRenderedEntityIdentity,
  verticalPublicationEligibility,
} from './publication.js';

export function pageClassHref(pageClass: PageClass, entity: Entity): string {
  return fillTemplate(pageClass.path, { canonical_slug: entity.canonical_slug });
}

export function entityHref(vertical: VerticalDeployment, entity: Entity): string | null {
  const pageClass = pageClassForEntityType(vertical.runtime.seo, entity.entity_type);
  if (pageClass === null) return null;
  return pageClassHref(pageClass, entity);
}

function robotsFor(seo: SeoConfig, passed: boolean): string {
  return passed ? 'index,follow' : seo.on_gate_failure.robots;
}

function combinedFailures(...groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())];
}

function coverageNotice(seo: SeoConfig, failed: boolean): string {
  if (!seo.on_gate_failure.show_coverage_notice || !failed) return '';
  // Gate and authorization diagnostics remain server-internal. Counts and
  // causes are differenceable and would turn this otherwise harmless notice
  // into a source/permission oracle.
  return '<div class="notice"><p>This page does not currently meet publication-quality requirements.</p></div>';
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
export async function renderParentIndex(deployment: RequestWebDeployment): Promise<string> {
  const verticals = [...deployment.verticals.values()].sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );
  const eligibility = await mapWithConcurrency(
    verticals,
    DEFAULT_CONCURRENCY,
    (vertical) => verticalPublicationEligibility(vertical),
  );
  const published = verticals
    .map((vertical, index) => ({ vertical, eligibility: eligibility[index] }))
    .filter((entry) => entry.eligibility?.publicWeb === true);
  const items = published
    .map(({ vertical: v }) => {
      const href = escapeAttr(v.runtime.seo.url_prefix);
      return `<a href="${href}">${escapeHtml(v.runtime.vertical_name)}</a> — <span>${escapeHtml(v.runtime.vertical_status)}</span>`;
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
    robots: published.length > 0 && published.every((entry) => entry.eligibility?.searchIndex === true)
      ? 'index,follow'
      : 'noindex,follow',
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

  // One rights-bound aggregate replaces one full catalog authorization scan per
  // entity type. A capacity refusal therefore starts only one bounded operation
  // instead of leaving sibling Promise.all scans running after the first error.
  const counts = await vertical.publicQueryModel.entityTypeCounts(vertical.verticalId);
  const byType = vertical.runtime.entity_types.map((entityType) => {
    const meta = vertical.runtime.entity_type_meta[entityType];
    return {
      entityType,
      count: counts.get(entityType as never) ?? 0,
      label: meta?.label_plural ?? entityType,
    };
  });

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
      if (!(await datasetRenderedCountsCovered(vertical))) {
        failures = combinedFailures(failures, ['rendered dataset counts differ by surface']);
      }
    } else {
      failures = ['dataset page quality gate is unavailable'];
    }
  } else {
    failures = ['dataset page policy is unavailable'];
  }
  const passed = failures.length === 0;

  const body = `
<h1>${escapeHtml(vertical.runtime.vertical_name)}</h1>
<p>${escapeHtml(vertical.runtime.vertical_status)} vertical. Browse by type, or <a href="${escapeHtml(`${seo.url_prefix}/search`)}">search all ${escapeHtml(vertical.runtime.vertical_name)} data</a>.</p>
${coverageNotice(seo, !passed)}
<h2>Browse</h2>
<ul>${browseLinks}</ul>
<p><a href="${escapeHtml(`${seo.url_prefix}/docs`)}">API &amp; MCP access</a> for programmatic and agent queries.</p>`;

  const html = layout({
    title: pageClass?.title ?? vertical.runtime.vertical_name,
    description: `Evidence-backed ${vertical.runtime.vertical_name} data: every value cites its source.`,
    canonicalUrl,
    robots: robotsFor(seo, passed),
    structuredData: passed ? datasetStructuredData(vertical, pageClass) : undefined,
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
  facts: readonly CanonicalFactView[],
  explanations: readonly (SurfaceFactExplanation | null)[],
  criticalProperties: readonly string[],
): Promise<string> {
  const published = facts.filter((fact) => fact.fact_id !== null);
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
  const content = await loadEntityContentIntersection(vertical, entity, {
    direction: 'both',
    depth: 1,
    limit: 50,
  });
  const relatedLinks = content.publicTraversal.edges
    .map((edge) => {
      const href = entityHref(vertical, edge.neighbor);
      if (href === null) return null;
      return `<li>${escapeHtml(edge.relationship.predicate)} — <a href="${escapeHtml(href)}">${escapeHtml(edge.neighbor.canonical_name)}</a></li>`;
    })
    .filter((x): x is string => x !== null);

  const title = fillTemplate(pageClass.title, { canonical_name: entity.canonical_name });
  const canonicalUrl = `${publicOrigin}${fillTemplate(pageClass.path, { canonical_slug: entity.canonical_slug })}`;

  const evidenceTable = await factsTable(
    content.publicFacts,
    content.publicExplanations,
    critical,
  );
  const contentBody = `
<h1>${escapeHtml(entity.canonical_name)}</h1>
<p class="evidence">Quality score ${entity.quality_score.toFixed(2)} · last verified ${entity.last_verified_at ?? 'never'}</p>
${evidenceTable}
${relatedLinks.length > 0 ? `<h2>Related</h2><ul>${relatedLinks.join('')}</ul>` : ''}`;

  const contentWords = countContentWords(contentBody.replace(/<[^>]+>/g, ' '));

  let failures: readonly string[] = content.searchIndexCoversRenderedContent
    ? []
    : ['SEARCH_INDEX does not cover the exact rendered entity claims'];
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
      (publicSignals as { related_entities?: number }).related_entities =
        content.publicTraversal.edges.length;
    }
    const publicFailures = evaluateGate(gate, publicSignals).failures;

    const indexBase = await computeEntitySignals(
      vertical.searchIndexQueryModel,
      entity.id,
      entity.quality_score,
      entity.updated_at,
      critical,
      {},
      now,
    );
    const indexSignals: GateSignals = { ...indexBase, unique_content_words: contentWords };
    if (gate.min_related_entities !== undefined) {
      (indexSignals as { related_entities?: number }).related_entities =
        content.indexTraversal.edges.length;
    }
    failures = combinedFailures(
      failures,
      publicFailures,
      evaluateGate(gate, indexSignals).failures,
    );
  } else {
    failures = combinedFailures(failures, ['entity page quality gate is unavailable']);
  }
  const passed = failures.length === 0;

  const body = `${coverageNotice(seo, !passed)}${contentBody}`;

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

function relationshipEvidenceCoverage(edges: readonly RelationshipEdge[]): number {
  return edges.length === 0
    ? 1
    : edges.filter((edge) => edge.evidence_count > 0).length / edges.length;
}

async function terminalEntityIndexable(
  vertical: VerticalDeployment,
  entity: Entity,
  now: Date,
): Promise<boolean> {
  const pageClass = pageClassForEntityType(vertical.runtime.seo, entity.entity_type);
  if (pageClass === null) return false;
  const gate = gateFor(vertical.runtime.seo, pageClass.quality_gate);
  if (gate === null) return false;

  const content = await loadEntityContentIntersection(vertical, entity);
  if (!content.searchIndexCoversRenderedContent) return false;
  const critical = vertical.runtime.critical_properties[entity.entity_type] ?? [];
  const [publicBase, indexBase] = await Promise.all([
    computeEntitySignals(
      vertical.publicQueryModel,
      entity.id,
      entity.quality_score,
      entity.updated_at,
      critical,
      {},
      now,
    ),
    computeEntitySignals(
      vertical.searchIndexQueryModel,
      entity.id,
      entity.quality_score,
      entity.updated_at,
      critical,
      {},
      now,
    ),
  ]);
  const publicSignals: GateSignals = { ...publicBase };
  const indexSignals: GateSignals = { ...indexBase };
  if (gate.min_related_entities !== undefined) {
    (publicSignals as { related_entities?: number }).related_entities =
      content.publicTraversal.edges.length;
    (indexSignals as { related_entities?: number }).related_entities =
      content.indexTraversal.edges.length;
  }
  // unique_content_words and other unavailable dimensions remain unmeasured,
  // so a target gate that requires them fails closed here.
  return evaluateGate(gate, publicSignals).passed && evaluateGate(gate, indexSignals).passed;
}

async function terminalChainIndexable(
  vertical: VerticalDeployment,
  start: Entity,
  now: Date,
): Promise<boolean> {
  const seen = new Set<string>();
  let current = start;
  for (let hop = 0; hop < 32; hop += 1) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);

    const query = {
      entity_id: current.id,
      predicate: 'supersedes' as never,
      direction: 'in' as const,
      depth: 1,
      limit: 2,
    };
    const [publicTraversal, indexTraversal] = await Promise.all([
      vertical.publicQueryModel.relationships(query),
      vertical.searchIndexQueryModel.relationships(query),
    ]);
    if (!relationshipTraversalEquivalent(publicTraversal, indexTraversal, true)) return false;
    if (publicTraversal.edges.length === 0) {
      return terminalEntityIndexable(vertical, current, now);
    }
    // Multiple active successors are ambiguous; choosing one would turn input
    // ordering into a recommendation. Resolve only an exact single chain.
    if (publicTraversal.edges.length !== 1) return false;
    current = publicTraversal.edges[0]!.neighbor;
  }
  return false;
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
  const query = {
    entity_id: entity.id,
    predicate: 'supersedes' as never,
    direction: 'in' as const,
    depth: 1,
    limit: 10,
  };
  const [publicTraversal, indexTraversal, indexView] = await Promise.all([
    vertical.publicQueryModel.relationships(query),
    vertical.searchIndexQueryModel.relationships(query),
    vertical.searchIndexQueryModel.getEntity(entity.id),
  ]);
  const replacements = publicTraversal.edges;
  const exactRenderedRelationships =
    indexView !== null &&
    sameRenderedEntityIdentity(entity, indexView.entity) &&
    relationshipTraversalEquivalent(publicTraversal, indexTraversal, true);
  const terminalResults = await mapWithConcurrency(
    replacements,
    DEFAULT_CONCURRENCY,
    (edge) => terminalChainIndexable(vertical, edge.neighbor, now),
  );
  const everyTerminalIndexable =
    replacements.length > 0 && terminalResults.every((result) => result);

  const title = fillTemplate(pageClass.title, { canonical_name: entity.canonical_name });
  const canonicalUrl = `${publicOrigin}${pageClassHref(pageClass, entity)}`;
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

  let failures: readonly string[] = exactRenderedRelationships
    ? []
    : ['SEARCH_INDEX does not cover the exact rendered replacement claims'];
  const gate = gateFor(seo, pageClass.quality_gate);
  if (gate !== null) {
    const publicSignals: GateSignals = {
      supersession_edges: replacements.length,
      terminal_model_indexable: everyTerminalIndexable,
      unique_content_words: contentWords,
      evidence_coverage: relationshipEvidenceCoverage(replacements),
    };
    const indexSignals: GateSignals = {
      supersession_edges: indexTraversal.edges.length,
      terminal_model_indexable: everyTerminalIndexable,
      unique_content_words: contentWords,
      evidence_coverage: relationshipEvidenceCoverage(indexTraversal.edges),
    };
    failures = combinedFailures(
      failures,
      evaluateGate(gate, publicSignals).failures,
      evaluateGate(gate, indexSignals).failures,
    );
  } else {
    failures = combinedFailures(failures, ['replacement quality gate is unavailable']);
  }
  const passed = failures.length === 0;

  const html = layout({
    title,
    description: `What replaces ${entity.canonical_name}, with evidence.`,
    canonicalUrl,
    robots: robotsFor(seo, passed),
    bodyHtml: `${coverageNotice(seo, !passed)}${contentBody}`,
    breadcrumbs: [
      { label: 'Data Foundry', href: '/' },
      { label: vertical.runtime.vertical_name, href: seo.url_prefix },
      { label: entity.canonical_name, href: entityHref(vertical, entity) ?? seo.url_prefix },
      { label: 'Replacements', href: canonicalUrl.slice(publicOrigin.length) },
    ],
  });
  return { html, status: 200 };
}

export function renderDocs(
  vertical: VerticalDeployment,
  publicOrigin: string,
  searchIndexEligible: boolean,
): RenderedPage {
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
    robots: robotsFor(seo, searchIndexEligible),
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
  searchIndexEligible: boolean,
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
    robots: hasQuery ? 'noindex,follow' : robotsFor(seo, searchIndexEligible),
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
