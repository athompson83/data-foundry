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
import type { WebRuntime } from './seo.js';

const READ_METHODS = new Set(['GET', 'HEAD']);
const PARSE_BASE = 'http://web.invalid';

export interface WebRoutingVertical {
  readonly slug: string;
  readonly runtime: WebRuntime;
}

/** The deployment metadata routing may inspect without binding query facades. */
export interface WebRoutingDeployment {
  readonly publicOrigin: string;
  readonly cacheMode?: WebContext['cacheMode'];
  readonly verticals: ReadonlyMap<string, WebRoutingVertical>;
}

function verticalFor(
  deployment: WebRoutingDeployment,
  pathname: string,
): WebRoutingVertical | null {
  for (const vertical of deployment.verticals.values()) {
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

function segmentFor(vertical: WebRoutingVertical, rest: string): SitemapSegmentMatch | null {
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

type PageClassMatch = NonNullable<ReturnType<typeof matchPageClass>>;

type PreparedVerticalRoute =
  | { readonly kind: 'sitemap'; readonly segment: SitemapSegmentMatch }
  | { readonly kind: 'landing' }
  | { readonly kind: 'search'; readonly q: string | null; readonly entityType: string | null }
  | { readonly kind: 'docs' }
  | { readonly kind: 'llms' }
  | {
      readonly kind: 'entity';
      readonly pageClass: PageClassMatch['pageClass'];
      readonly slug: string;
      readonly entityType: string;
    };

/** Route against cached runtime metadata only; no query facade exists here. */
function prepareVerticalRoute(
  vertical: WebRoutingVertical,
  pathname: string,
  query: URLSearchParams,
): PreparedVerticalRoute | null {
  const prefix = vertical.runtime.seo.url_prefix;
  const rest = pathname.slice(prefix.length);

  if (rest === '/sitemaps' || rest.startsWith('/sitemaps/')) {
    const segment = segmentFor(vertical, rest);
    return segment === null ? null : { kind: 'sitemap', segment };
  }
  if (rest === '' || rest === '/') return { kind: 'landing' };
  if (rest === '/search') {
    return { kind: 'search', q: query.get('q'), entityType: query.get('type') };
  }
  if (rest === '/docs') return { kind: 'docs' };
  if (rest === '/llms.txt' || rest === '/llms-full.txt') return { kind: 'llms' };

  const match = matchPageClass(vertical.runtime.seo, pathname);
  if (match === null) return null;
  const slug = match.params['canonical_slug'];
  if (slug === undefined) return null;
  const entityType =
    match.pageClass.route_kind === 'entity_detail'
      ? match.pageClass.entity_type
      : match.pageClass.route_kind === 'relationship'
        ? match.pageClass.subject_entity_type
        : null;
  // Static routes are handled above. Comparison and filtered-collection
  // routing remain deliberately unavailable until their declared gate inputs
  // can be measured honestly.
  if (entityType === null) return null;
  return { kind: 'entity', pageClass: match.pageClass, slug, entityType };
}

async function executeVerticalRoute(
  vertical: VerticalDeployment,
  context: WebContext,
  route: PreparedVerticalRoute,
): Promise<VerticalResult> {
  const origin = context.deployment.publicOrigin;

  // The sitemap owns its validated request budget and can reject an impossible
  // shard from configuration alone. Do not spend an eligibility query first.
  if (route.kind === 'sitemap') {
    const xml = await sitemapSegmentXml(
      vertical,
      origin,
      route.segment.id,
      context.now(),
      route.segment.shard,
    );
    return { kind: 'xml', body: xml };
  }

  const eligibility = await verticalPublicationEligibility(vertical);
  if (!eligibility.publicWeb) {
    return { kind: 'html', status: 404, body: render404(origin).html };
  }

  if (route.kind === 'landing') {
    const page = await renderDatasetLanding(vertical, origin);
    return { kind: 'html', status: page.status, body: page.html };
  }
  if (route.kind === 'search') {
    const page = await renderSearch(
      vertical,
      origin,
      {
        ...(route.q === null ? {} : { q: route.q }),
        ...(route.entityType === null ? {} : { type: route.entityType }),
      },
      eligibility.searchIndex,
    );
    return { kind: 'html', status: page.status, body: page.html };
  }
  if (route.kind === 'docs') {
    const page = renderDocs(vertical, origin, eligibility.searchIndex);
    return { kind: 'html', status: page.status, body: page.html };
  }
  if (route.kind === 'llms') {
    return {
      kind: 'text',
      body: llmsTxt(vertical, origin),
      ...(eligibility.searchIndex
        ? {}
        : { headers: { 'x-robots-tag': 'noindex, follow' } }),
    };
  }
  const view = await vertical.publicQueryModel.getEntityBySlug(
    vertical.verticalId,
    route.entityType as never,
    route.slug as never,
  );
  if (view === null) return { kind: 'html', status: 404, body: render404(origin).html };
  if (
    view.redirected_from !== null &&
    vertical.runtime.seo.canonical.redirect_on_merge
  ) {
    return {
      kind: 'redirect',
      location: pageClassHref(route.pageClass, view.entity),
      status: vertical.runtime.seo.canonical.redirect_status,
    };
  }

  const page =
    route.pageClass.route_kind === 'relationship'
      ? await renderReplacement(vertical, view, route.pageClass, origin, context.now())
      : await renderEntityDetail(vertical, view, route.pageClass, origin, context.now());
  return { kind: 'html', status: page.status, body: page.html };
}

export type PreparedWebRequest =
  | { readonly kind: 'static'; readonly response: WebResponse }
  | {
      readonly kind: 'canonical';
      readonly execute: (context: WebContext) => Promise<WebResponse>;
    };

function resultResponse(result: VerticalResult, cacheMode: WebContext['cacheMode']): WebResponse {
  const mode = cacheMode ?? 'cache';
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
      return xmlResponse(200, result.body, mode);
    case 'text':
      return textResponse(200, result.body, result.headers, mode);
    case 'html':
      return htmlResponse(result.status, result.body, {}, mode);
  }
}

const staticResponse = (response: WebResponse): PreparedWebRequest => ({
  kind: 'static',
  response,
});

const canonicalResponse = (
  execute: (context: WebContext) => Promise<WebResponse>,
): PreparedWebRequest => ({ kind: 'canonical', execute });

/**
 * Decide whether a request needs canonical data using cached runtime metadata
 * only. A token-bound `WebContext` cannot exist until the returned canonical
 * execution is accepted by this function.
 */
export function prepareWebRequest(
  deployment: WebRoutingDeployment,
  request: WebRequest,
): PreparedWebRequest {
  const notFoundHtml = (): string => render404(deployment.publicOrigin).html;
  const cacheMode = deployment.cacheMode ?? 'cache';

  if (!READ_METHODS.has(request.method.toUpperCase())) {
    return staticResponse(htmlResponse(405, notFoundHtml(), {}, cacheMode));
  }

  let url: URL;
  try {
    url = new URL(request.url, PARSE_BASE);
  } catch {
    return staticResponse(notFound(notFoundHtml()));
  }
  const pathname = url.pathname;

  if (pathname === '/') {
    return canonicalResponse(async (context) =>
      htmlResponse(200, await renderParentIndex(context.deployment), {}, cacheMode),
    );
  }
  if (pathname === '/robots.txt') {
    return staticResponse(textResponse(200, robotsTxt(deployment), {}, cacheMode));
  }
  if (pathname === '/sitemap-index.xml') {
    return canonicalResponse(async (context) =>
      xmlResponse(
        200,
        await sitemapIndexXml(context.deployment, context.now()),
        cacheMode,
      ),
    );
  }

  const vertical = verticalFor(deployment, pathname);
  if (vertical === null) return staticResponse(notFound(notFoundHtml()));

  const route = prepareVerticalRoute(vertical, pathname, url.searchParams);
  if (route === null) return staticResponse(notFound(notFoundHtml()));

  return canonicalResponse(async (context) => {
    const requestVertical = context.deployment.verticals.get(vertical.slug);
    if (requestVertical === undefined) return notFound(notFoundHtml());
    return resultResponse(
      await executeVerticalRoute(requestVertical, context, route),
      context.cacheMode,
    );
  });
}

/** Execute one accepted canonical route and preserve its opaque refusal contract. */
export async function executePreparedWebRequest(
  prepared: Extract<PreparedWebRequest, { readonly kind: 'canonical' }>,
  context: WebContext,
): Promise<WebResponse> {
  try {
    return await prepared.execute(context);
  } catch (error) {
    if (error instanceof SitemapCapacityError) return serviceUnavailable();
    if (error instanceof SurfaceCatalogCapacityError) return capacityUnavailable();
    throw error;
  }
}

export function createWebApp(context: WebContext): WebHandler {
  return async (request: WebRequest) => {
    const prepared = prepareWebRequest(context.deployment, request);
    return prepared.kind === 'static'
      ? prepared.response
      : executePreparedWebRequest(prepared, context);
  };
}
