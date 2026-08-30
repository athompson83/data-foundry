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

/** `decodeURIComponent` throws `URIError` on a malformed escape (`%ZZ`, a lone `%`, a truncated UTF-8 sequence). */
function tryDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function matchPageClass(seo: SeoConfig, pathname: string): PageMatch | null {
  for (const pageClass of seo.page_classes) {
    const match = toRegex(pageClass.path).exec(pathname);
    if (match === null) continue;

    const params: Record<string, string> = {};
    let malformed = false;
    for (const [key, value] of Object.entries(match.groups ?? {})) {
      if (value === undefined) continue;
      const decoded = tryDecode(value);
      // A malformed capture is not evidence this page class doesn't match —
      // the same raw bytes would fail to decode against every other page
      // class's pattern too. It IS evidence the request names no valid
      // resource, so this falls through to the caller's ordinary 404 rather
      // than throwing past every route handler into index.ts's outer catch,
      // which would otherwise turn it into a 503 — a client's malformed
      // request is not a "this deployment is not configured" outage.
      if (decoded === null) {
        malformed = true;
        break;
      }
      params[key] = decoded;
    }
    if (malformed) return null;
    return { pageClass, params };
  }
  return null;
}

/** `url_prefix + "/sitemaps/entities-1.xml"` — this Worker serves many verticals from one origin. */
export function sitemapSegmentUrl(urlPrefix: string, segmentPathTemplate: string): string {
  return `${urlPrefix}${segmentPathTemplate}`;
}
