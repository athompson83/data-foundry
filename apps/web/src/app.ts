/**
 * Dispatch: URL in, `WebResponse` out — same discipline as `apps/api/src/app.ts`.
 *
 * This surface is deliberately GET/HEAD only, same as the metered API,
 * because it is equally read-only; the difference is that here nothing is
 * metered or authenticated at all (ADR-0011: the human site is the free,
 * crawlable half of the revenue split, and the paid API is `apps/edge`).
 */
import type { VerticalDeployment } from './composition.js';
import { SurfaceCatalogCapacityError } from '@data-foundry/query-model';
import type { WebContext } from './config.js';
import {
  capacityUnavailable,
  htmlResponse,
  notFound,
  serviceUnavailable,
  textResponse,
  xmlResponse,
  type WebHandler,
  type WebRequest,
  type WebResponse,
} from './http.js';
import { llmsTxt } from './llms.js';
import {
  pageClassHref,
  render404,
  renderDatasetLanding,
  renderDocs,
  renderEntityDetail,
  renderParentIndex,
  renderReplacement,
  renderSearch,
} from './pages.js';
import { matchPageClass } from './router.js';
import { robotsTxt } from './robots.js';
import { sitemapIndexXml, sitemapSegmentXml } from './sitemap.js';
import { verticalPublicationEligibility } from './publication.js';
import { SitemapCapacityError } from './sitemap-capacity.js';

const READ_METHODS = new Set(['GET', 'HEAD']);
const PARSE_BASE = 'http://web.invalid';

function verticalFor(context: WebContext, pathname: string): VerticalDeployment | null {
  for (const vertical of context.deployment.verticals.values()) {
    const prefix = vertical.runtime.seo.url_prefix;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return vertical;
  }
  return null;
}

/** `/sitemaps/entities-{n}.xml` -> a regex matching `/sitemaps/entities-1.xml`, etc. */
function segmentRegex(pathTemplate: string): RegExp {
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = pathTemplate.split('{n}');
  if (parts.length !== 2) return new RegExp(`^${escape(pathTemplate)}$`);
  return new RegExp(`^${escape(parts[0] ?? '')}([1-9]\\d*)${escape(parts[1] ?? '')}$`);
}

interface SitemapSegmentMatch {
  readonly id: string;
  readonly shard: number;
}

function segmentFor(vertical: VerticalDeployment, rest: string): SitemapSegmentMatch | null {
  for (const segment of vertical.runtime.seo.sitemaps.segments) {
    const match = segmentRegex(segment.path).exec(rest);
    if (match === null) continue;
    if (match[1] === undefined) return { id: segment.id, shard: 1 };
    const shard = Number(match[1]);
    if (
      !Number.isSafeInteger(shard) ||
      shard < 1 ||
      String(shard) !== match[1]
    ) return null;
    return { id: segment.id, shard };
  }
  return null;
}

type VerticalResult =
  | { readonly kind: 'html'; readonly status: number; readonly body: string }
  | { readonly kind: 'xml'; readonly body: string }
  | {
      readonly kind: 'text';
      readonly body: string;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'redirect'; readonly location: string; readonly status: number };

async function dispatchVertical(
  vertical: VerticalDeployment,
  context: WebContext,
  pathname: string,
  query: URLSearchParams,
): Promise<VerticalResult | null> {
  const origin = context.deployment.publicOrigin;
  const prefix = vertical.runtime.seo.url_prefix;
  const rest = pathname.slice(prefix.length);

  // The sitemap owns its validated request budget and can reject an impossible
  // shard from configuration alone. Do not spend an eligibility query first.
  if (rest === '/sitemaps' || rest.startsWith('/sitemaps/')) {
    const segment = segmentFor(vertical, rest);
    if (segment === null) return null;
    const xml = await sitemapSegmentXml(
      vertical,
      origin,
      segment.id,
      context.now(),
      segment.shard,
    );
    return { kind: 'xml', body: xml };
  }

  const eligibility = await verticalPublicationEligibility(vertical);
  if (!eligibility.publicWeb) return null;

  if (rest === '' || rest === '/') {
    const page = await renderDatasetLanding(vertical, origin);
    return { kind: 'html', status: page.status, body: page.html };
  }
  if (rest === '/search') {
    const q = query.get('q');
    const type = query.get('type');
    const page = await renderSearch(
      vertical,
      origin,
      {
        ...(q === null ? {} : { q }),
        ...(type === null ? {} : { type }),
      },
      eligibility.searchIndex,
    );
    return { kind: 'html', status: page.status, body: page.html };
  }
  if (rest === '/docs') {
    const page = renderDocs(vertical, origin, eligibility.searchIndex);
    return { kind: 'html', status: page.status, body: page.html };
  }
  if (rest === '/llms.txt' || rest === '/llms-full.txt') {
    return {
      kind: 'text',
      body: llmsTxt(vertical, origin),
      ...(eligibility.searchIndex
        ? {}
        : { headers: { 'x-robots-tag': 'noindex, follow' } }),
    };
  }
  const match = matchPageClass(vertical.runtime.seo, pathname);
  if (match === null) return null;
  const { pageClass, params } = match;

  const slug = params['canonical_slug'];
  if (slug === undefined) return null;
  const entityType =
    pageClass.route_kind === 'entity_detail'
      ? pageClass.entity_type
      : pageClass.route_kind === 'relationship'
        ? pageClass.subject_entity_type
        : null;
  // Static routes are handled above. Comparison and filtered-collection
  // routing remain deliberately unavailable until their declared gate inputs
  // can be measured honestly.
  if (entityType === null) return null;
  const view = await vertical.publicQueryModel.getEntityBySlug(
    vertical.verticalId,
    entityType as never,
    slug as never,
  );
  if (view === null) return null;
  if (
    view.redirected_from !== null &&
    vertical.runtime.seo.canonical.redirect_on_merge
  ) {
    return {
      kind: 'redirect',
      location: pageClassHref(pageClass, view.entity),
      status: vertical.runtime.seo.canonical.redirect_status,
    };
  }

  const page =
    pageClass.route_kind === 'relationship'
      ? await renderReplacement(vertical, view, pageClass, origin, context.now())
      : await renderEntityDetail(vertical, view, pageClass, origin, context.now());
  return { kind: 'html', status: page.status, body: page.html };
}

async function dispatch(context: WebContext, request: WebRequest): Promise<WebResponse> {
  const notFoundHtml = (): string => render404(context.deployment.publicOrigin).html;
  const cacheMode = context.cacheMode ?? 'cache';

  if (!READ_METHODS.has(request.method.toUpperCase())) {
    return htmlResponse(405, notFoundHtml(), {}, cacheMode);
  }

  let url: URL;
  try {
    url = new URL(request.url, PARSE_BASE);
  } catch {
    return notFound(notFoundHtml());
  }
  const pathname = url.pathname;

  if (pathname === '/') return htmlResponse(200, await renderParentIndex(context.deployment), {}, cacheMode);
  if (pathname === '/robots.txt') return textResponse(200, robotsTxt(context.deployment), {}, cacheMode);
  if (pathname === '/sitemap-index.xml') {
    return xmlResponse(200, await sitemapIndexXml(context.deployment, context.now()), cacheMode);
  }

  const vertical = verticalFor(context, pathname);
  if (vertical === null) return notFound(notFoundHtml());

  const result = await dispatchVertical(vertical, context, pathname, url.searchParams);
  if (result === null) return notFound(notFoundHtml());

  switch (result.kind) {
    case 'redirect':
      return {
        status: result.status,
        headers: {
          location: result.location,
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        },
        body: '',
      };
    case 'xml':
      return xmlResponse(200, result.body, cacheMode);
    case 'text':
      return textResponse(200, result.body, result.headers, cacheMode);
    case 'html':
      return htmlResponse(result.status, result.body, {}, cacheMode);
  }
}

export function createWebApp(context: WebContext): WebHandler {
  return async (request: WebRequest) => {
    try {
      return await dispatch(context, request);
    } catch (error) {
      if (error instanceof SitemapCapacityError) return serviceUnavailable();
      if (error instanceof SurfaceCatalogCapacityError) return capacityUnavailable();
      throw error;
    }
  };
}
