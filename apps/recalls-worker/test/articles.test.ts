import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Article } from '../src/articles.js';
import type { Env } from '../src/env.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';

// Fixed fixtures, so these route tests do not change whenever content/articles does.
// The committed articles are checked below through vi.importActual.
vi.mock('../generated/articles.js', () => ({
  ARTICLES: [
    {
      slug: 'newer-article',
      title: 'Newer article',
      description: 'The newer of two fixture articles.',
      publishedAt: '2026-09-20',
      updatedAt: '2026-09-25',
      author: 'Data Foundry',
      dataset: 'fda-recalls',
      html: '<p>Body of the newer article.</p>\n<pre><code class="language-bash">curl &quot;https://api.data.aroqon.com/v1/recalls/stats&quot;\n</code></pre>\n',
    },
    {
      slug: 'older-article',
      title: 'Older article',
      description: 'The older of two fixture articles.',
      publishedAt: '2026-09-01',
      updatedAt: null,
      author: 'Jane Writer',
      dataset: null,
      html: '<p>Body of the older article.</p>\n',
    },
  ] satisfies Article[],
}));

const { default: worker } = await import('../src/index.js');
const { articleJsonLd, articlePage, articleSitemapEntries, articlesIndexPage } = await import('../src/articles.js');

const ctx = { publicOrigin: 'https://data.aroqon.com', apiOrigin: 'https://api.data.aroqon.com', supportEmail: 'data@example.com' };

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { DB: createTestDatabase().db, RAW_ARTIFACTS: createTestBucket(), PUBLIC_ORIGIN: ctx.publicOrigin, API_ORIGIN: ctx.apiOrigin, ...overrides };
}

const site = (path: string) => new Request(`https://data.aroqon.com${path}`);
const api = (path: string) => new Request(`https://api.data.aroqon.com${path}`);
const jsonLd = (page: string) => [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((match) => JSON.parse(match[1] as string) as Record<string, unknown>);

beforeEach(() => {
  const store = new Map<string, Response>();
  (globalThis as unknown as { caches: unknown }).caches = {
    default: {
      match: async (request: Request) => store.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => void store.set(request.url, response),
    },
  };
});

describe('articles on data.aroqon.com', () => {
  it('lists articles newest first on the public host, cached like the other public pages', async () => {
    const response = await worker.fetch(site('/articles'), makeEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const page = await response.text();
    expect(page).toContain('<link rel="canonical" href="https://data.aroqon.com/articles">');
    expect(page).not.toContain('noindex');
    expect(page.indexOf('href="/articles/newer-article"')).toBeGreaterThan(-1);
    expect(page.indexOf('href="/articles/newer-article"')).toBeLessThan(page.indexOf('href="/articles/older-article"'));
  });

  it('serves one article with canonical URL, Open Graph tags and Article JSON-LD that match the visible byline', async () => {
    const response = await worker.fetch(site('/articles/newer-article'), makeEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const page = await response.text();
    expect(page).toContain('<title>Newer article — Data Foundry</title>');
    expect(page).toContain('<meta name="description" content="The newer of two fixture articles.">');
    expect(page).toContain('<link rel="canonical" href="https://data.aroqon.com/articles/newer-article">');
    for (const tag of [
      '<meta property="og:type" content="article">',
      '<meta property="og:title" content="Newer article">',
      '<meta property="og:url" content="https://data.aroqon.com/articles/newer-article">',
      '<meta property="article:published_time" content="2026-09-20">',
      '<meta property="article:modified_time" content="2026-09-25">',
    ]) expect(page).toContain(tag);
    expect(page).toContain('By <span class="author">Data Foundry</span> · Published <time datetime="2026-09-20">2026-09-20</time> · Updated <time datetime="2026-09-25">2026-09-25</time>');
    expect(page).toContain('<pre><code class="language-bash">');
    expect(page).toContain('Dataset: <a href="/recalls">FDA Recall Intelligence</a>');
    const [ld] = jsonLd(page);
    expect(ld).toMatchObject({
      '@type': 'Article',
      headline: 'Newer article',
      url: 'https://data.aroqon.com/articles/newer-article',
      datePublished: '2026-09-20',
      dateModified: '2026-09-25',
      author: { '@type': 'Organization', name: 'Data Foundry' },
      about: { '@id': 'https://data.aroqon.com/recalls#dataset' },
    });
    expect(page).not.toContain('FAQPage');
  });

  it('uses the publication date as dateModified, and a Person author, when that is what the page shows', async () => {
    const page = await (await worker.fetch(site('/articles/older-article'), makeEnv())).text();
    expect(page).toContain('By <span class="author">Jane Writer</span> · Published <time datetime="2026-09-01">2026-09-01</time></p>');
    expect(page).not.toContain('Updated');
    expect(jsonLd(page)[0]).toMatchObject({ datePublished: '2026-09-01', dateModified: '2026-09-01', author: { '@type': 'Person', name: 'Jane Writer' } });
    expect(jsonLd(page)[0]).not.toHaveProperty('about');
  });

  it('returns the site 404 page for an unknown or malformed slug', async () => {
    for (const path of ['/articles/no-such-article', '/articles/Newer-Article', '/articles/newer-article/', '/articles/']) {
      const response = await worker.fetch(site(path), makeEnv());
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).toContain('<h1>Not found</h1>');
    }
  });

  it('does not serve articles on the API host', async () => {
    for (const path of ['/articles', '/articles/newer-article']) {
      const response = await worker.fetch(api(path), makeEnv());
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type'), path).toContain('application/json');
    }
  });

  it('lists /articles and every article in the sitemap, with last-modified dates', async () => {
    const env = makeEnv();
    const index = await (await worker.fetch(site('/sitemap.xml'), env)).text();
    expect(index).toContain('<loc>https://data.aroqon.com/sitemaps/pages.xml</loc>');
    const pages = await (await worker.fetch(site('/sitemaps/pages.xml'), env)).text();
    expect(pages).toContain('<url><loc>https://data.aroqon.com/articles</loc><lastmod>2026-09-25</lastmod></url>');
    expect(pages).toContain('<url><loc>https://data.aroqon.com/articles/newer-article</loc><lastmod>2026-09-25</lastmod></url>');
    expect(pages).toContain('<url><loc>https://data.aroqon.com/articles/older-article</loc><lastmod>2026-09-01</lastmod></url>');
    expect(pages).toContain('<url><loc>https://data.aroqon.com/recalls</loc></url>');
  });

  it('lists articles in llms.txt and links them from the site navigation and footer', async () => {
    const env = makeEnv();
    const llms = await (await worker.fetch(site('/llms.txt'), env)).text();
    expect(llms).toContain('## Articles\n\n- [Newer article](https://data.aroqon.com/articles/newer-article): The newer of two fixture articles.');
    expect(await (await worker.fetch(site('/llms-full.txt'), env)).text()).toContain('https://data.aroqon.com/articles/older-article');
    const home = await (await worker.fetch(site('/'), env)).text();
    expect(home).toContain('<a href="/recalls#pricing">Pricing</a><a href="/articles">Articles</a></nav>');
    expect(home).toContain('· <a href="/articles">Articles</a> ·');
  });

  it('keeps articles up under the recall kill switch, which withdraws only dataset-derived responses', async () => {
    const killed = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    expect((await worker.fetch(site('/articles'), killed)).status).toBe(200);
    expect((await worker.fetch(site('/articles/newer-article'), killed)).status).toBe(200);
  });

  it('shows an unindexed empty state and no sitemap entries when there are no articles', () => {
    const page = articlesIndexPage(ctx, []);
    expect(page).toContain('No articles yet.');
    expect(page).toContain('<meta name="robots" content="noindex, follow">');
    expect(articleSitemapEntries(ctx, [])).toEqual([]);
  });

  it('escapes frontmatter text in HTML and JSON-LD', () => {
    const hostile: Article = { slug: 'x', title: 'A </script><script>alert(1)</script> title', description: '"quoted" <b>', publishedAt: '2026-09-01', updatedAt: null, author: '<i>me</i>', dataset: null, html: '<p>x</p>' };
    const page = articlePage(ctx, hostile);
    expect(page).not.toContain('<script>alert(1)');
    expect(page).not.toContain('<i>me</i>');
    expect(page).toContain('content="&quot;quoted&quot; &lt;b&gt;"');
    expect(page).toContain('\\u003c/script>');
  });
});

describe('committed articles', () => {
  it('each render with a byline and dates that match their JSON-LD', async () => {
    const { ARTICLES } = await vi.importActual<{ ARTICLES: readonly Article[] }>('../generated/articles.js');
    for (const article of ARTICLES) {
      const page = articlePage(ctx, article);
      const ld = jsonLd(page)[0] as Record<string, unknown>;
      expect(ld, article.slug).toEqual(articleJsonLd(ctx, article));
      expect(page, article.slug).toContain(`By <span class="author">${ld['author'] && (ld['author'] as { name: string }).name}</span> · Published <time datetime="${ld['datePublished']}">`);
      if (article.updatedAt) expect(page, article.slug).toContain(`Updated <time datetime="${ld['dateModified']}">`);
      else expect(ld['dateModified'], article.slug).toBe(ld['datePublished']);
      expect(page, article.slug).not.toContain('FAQPage');
    }
  });
});
