/**
 * `llms.txt` (doc 07 layer 2) — a per-vertical, plain-text map for an LLM or
 * agent, distinct from a page's SEO metadata: sections here are always
 * served regardless of a page's own indexability, because "not indexable"
 * means a search engine should not recommend it, not that an agent that asked
 * for it by name should be refused (`markdown_for_non_indexable: true` in
 * `seo.yaml`, applied here at the discovery-document level).
 */
import type { VerticalDeployment } from './composition.js';

export function llmsTxt(vertical: VerticalDeployment, publicOrigin: string): string {
  const { vertical_name, vertical_status } = vertical.runtime;
  const seo = vertical.runtime.seo;
  const lines: string[] = [`# ${vertical_name}`, '', `Status: ${vertical_status}`, ''];

  const include = new Set(seo.llm_discovery.include ?? []);

  if (include.has('dataset_description')) {
    lines.push(
      '## Dataset',
      `Evidence-backed ${vertical_name} data. Every published value cites the source and rule that ` +
        'selected it; conflicting claims are recorded, not hidden.',
      '',
    );
  }
  if (include.has('resource_groups')) {
    lines.push('## Resource groups', ...vertical.runtime.entity_types.map((t) => `- ${t}`), '');
  }
  if (include.has('api_docs') || include.has('openapi_url')) {
    lines.push('## API', `Docs: ${publicOrigin}${seo.url_prefix}/docs`, '');
  }
  if (include.has('mcp_endpoint')) {
    lines.push('## MCP', 'This vertical exposes an MCP tool contract over the same canonical data. See the docs page.', '');
  }
  if (include.has('licensing_and_access_terms')) {
    lines.push(
      '## Licensing',
      // publicOrigin is this deployment's own host — it doesn't serve
      // DATA_RIGHTS.md (a repo-root file, not a route this Worker owns), so
      // that link has to point at the source of truth instead of a 404.
      'Platform code is MIT. Data itself is governed per-source rights, not by the code licence — see ' +
        'https://github.com/athompson83/data-foundry/blob/main/DATA_RIGHTS.md.',
      '',
    );
  }
  if (include.has('freshness_and_changelog')) {
    lines.push('## Freshness', `Default refresh cadence and per-source status are recorded in the vertical's CHANGELOG.`, '');
  }

  const intents = seo.agent_intents ?? {};
  if (Object.keys(intents).length > 0) {
    lines.push('## Intents');
    for (const [intent, spec] of Object.entries(intents)) {
      lines.push(`### ${intent} -> ${spec.tool}`);
      for (const example of spec.examples) lines.push(`- "${example}"`);
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}
