/**
 * Matches a request path against one vertical's `seo.yaml` page classes.
 *
 * `page_classes[].path` is already fully qualified from the root (it includes
 * `url_prefix` — e.g. `/data/hvac/equipment/{canonical_slug}`), so matching is
 * a single regex built from the template, not a two-step "strip prefix, then
 * match the remainder". `{word}` becomes a named capture group; everything
 * else in the template is matched literally.
 */
import type { PageClass, SeoConfig } from './seo.js';

function toRegex(pathTemplate: string): RegExp {
  const escaped = pathTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withParams = escaped.replace(/\\\{(\w+)\\\}/g, (_match, name: string) => `(?<${name}>[^/]+)`);
  return new RegExp(`^${withParams}$`);
}

export interface PageMatch {
  readonly pageClass: PageClass;
  readonly params: Readonly<Record<string, string>>;
}

export function matchPageClass(seo: SeoConfig, pathname: string): PageMatch | null {
  for (const pageClass of seo.page_classes) {
    const match = toRegex(pageClass.path).exec(pathname);
    if (match !== null) {
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(match.groups ?? {})) {
        if (value !== undefined) params[key] = decodeURIComponent(value);
      }
      return { pageClass, params };
    }
  }
  return null;
}

/** `url_prefix + "/sitemaps/entities-1.xml"` — this Worker serves many verticals from one origin. */
export function sitemapSegmentUrl(urlPrefix: string, segmentPathTemplate: string): string {
  return `${urlPrefix}${segmentPathTemplate}`;
}
