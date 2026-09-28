/**
 * Owned articles at data.aroqon.com/articles (docs/articles.md). The Markdown
 * lives in content/articles/ and is validated and rendered at build time by
 * tooling/scripts/generate-articles.ts; this module only lays out what that
 * generator produced. Articles are not dataset-derived, so, like the other
 * static pages, they are not withdrawn by SOURCE_KILL_SWITCH.
 */

import { ARTICLES } from '../generated/articles.js';
import { escapeHtml, layout, type PageContext } from './pages.js';
import { organization } from './seo.js';

export interface Article {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  /** YYYY-MM-DD. */
  readonly publishedAt: string;
  /** YYYY-MM-DD, never earlier than publishedAt; null when never updated. */
  readonly updatedAt: string | null;
  readonly author: string;
  /** A LIVE key from docs/sources/pipeline/candidates.yaml. */
  readonly dataset: string | null;
  /** Rendered and sanitised by the generator. */
  readonly html: string;
}

export const ARTICLE_PAGE_PATTERN = /^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** Datasets that have a page on this Worker, so an article can link to it and name it in JSON-LD. */
export const DATASET_PAGES: Readonly<Record<string, { readonly name: string; readonly path: string; readonly id: string }>> = {
  'fda-recalls': { name: 'FDA Recall Intelligence', path: '/recalls', id: '/recalls#dataset' },
};

/** Bylines naming the publisher itself are an Organization in JSON-LD; anything else is a person. */
const ORGANIZATION_AUTHORS = new Set(['Data Foundry', 'Data Foundry by Aroqon Data', 'Aroqon Data']);

/** Newest first, as the generator sorted them. */
export function publishedArticles(): readonly Article[] {
  return ARTICLES;
}

export function articleBySlug(slug: string): Article | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}

export function articlePath(article: Pick<Article, 'slug'>): string {
  return `/articles/${article.slug}`;
}

export function modifiedOn(article: Pick<Article, 'publishedAt' | 'updatedAt'>): string {
  return article.updatedAt ?? article.publishedAt;
}

export function articleJsonLd(ctx: PageContext, article: Article): Record<string, unknown> {
  const url = `${ctx.publicOrigin}${articlePath(article)}`;
  const dataset = article.dataset ? DATASET_PAGES[article.dataset] : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${url}#article`,
    mainEntityOfPage: url,
    url,
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: modifiedOn(article),
    // The name is the visible byline verbatim, so the two cannot disagree.
    author: ORGANIZATION_AUTHORS.has(article.author) ? { '@type': 'Organization', name: article.author, url: `${ctx.publicOrigin}/` } : { '@type': 'Person', name: article.author },
    publisher: organization(ctx),
    inLanguage: 'en',
    ...(dataset ? { about: { '@id': `${ctx.publicOrigin}${dataset.id}` } } : {}),
  };
}

function byline(article: Article): string {
  const updated = article.updatedAt ? ` · Updated <time datetime="${escapeHtml(article.updatedAt)}">${escapeHtml(article.updatedAt)}</time>` : '';
  return `<p class="byline small muted">By <span class="author">${escapeHtml(article.author)}</span> · Published <time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(article.publishedAt)}</time>${updated}</p>`;
}

export function articlePage(ctx: PageContext, article: Article): string {
  const path = articlePath(article);
  const dataset = article.dataset ? DATASET_PAGES[article.dataset] : undefined;
  const body = `<p class="small muted"><a href="/articles">Articles</a></p>
<article class="prose"><h1>${escapeHtml(article.title)}</h1>
${byline(article)}
${article.html}</article>
${dataset ? `<p class="small muted">Dataset: <a href="${dataset.path}">${escapeHtml(dataset.name)}</a></p>` : ''}`;
  return layout(ctx, `${article.title} — Data Foundry`, article.description, body, {
    path,
    jsonLd: [articleJsonLd(ctx, article)],
    openGraph: {
      'og:type': 'article',
      'og:title': article.title,
      'og:description': article.description,
      'og:url': `${ctx.publicOrigin}${path}`,
      'og:site_name': 'Data Foundry',
      'article:published_time': article.publishedAt,
      'article:modified_time': modifiedOn(article),
    },
  });
}

export function articlesIndexPage(ctx: PageContext, articles: readonly Article[] = publishedArticles()): string {
  const list = articles
    .map(
      (article) => `<li><h2><a href="${articlePath(article)}">${escapeHtml(article.title)}</a></h2>
<p class="small muted">${escapeHtml(article.author)} · <time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(article.publishedAt)}</time>${article.updatedAt ? ` · updated <time datetime="${escapeHtml(article.updatedAt)}">${escapeHtml(article.updatedAt)}</time>` : ''}</p>
<p>${escapeHtml(article.description)}</p></li>`,
    )
    .join('');
  const body = articles.length
    ? `<ul class="articles">${list}</ul>`
    : `<p class="muted">No articles yet. Meanwhile, the <a href="/docs">API docs</a> show every endpoint with a working request.</p>`;
  return layout(
    ctx,
    'Articles — Data Foundry',
    'Dataset launches and developer articles from Data Foundry: what each dataset contains, how it is structured, and real API requests.',
    `<h1>Articles</h1><p class="lede">Dataset launches and developer notes: what each dataset holds, what we structure, and the request that gets it.</p>${body}`,
    // An empty index is a thin page (rule 8): reachable, but not indexed.
    { path: '/articles', ...(articles.length ? {} : { robots: 'noindex, follow' }) },
  );
}

/** Sitemap entries for /articles and each article, or none while there are no articles. */
export function articleSitemapEntries(ctx: PageContext, articles: readonly Article[] = publishedArticles()): Array<{ loc: string; lastmod?: string }> {
  if (articles.length === 0) return [];
  const newest = articles.map(modifiedOn).sort().at(-1) as string;
  return [{ loc: `${ctx.publicOrigin}/articles`, lastmod: newest }, ...articles.map((article) => ({ loc: `${ctx.publicOrigin}${articlePath(article)}`, lastmod: modifiedOn(article) }))];
}

/** The llms.txt lines for articles: title, URL and summary. */
export function articleLlmsLinks(ctx: PageContext, articles: readonly Article[] = publishedArticles()): Array<{ title: string; url: string; description: string }> {
  return articles.map((article) => ({ title: article.title, url: `${ctx.publicOrigin}${articlePath(article)}`, description: article.description }));
}
