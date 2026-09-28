/**
 * Owned articles (docs/articles.md): the loader that validates content/articles
 * and the renderer that turns Markdown into the HTML the recall Worker serves.
 * The last block proves the committed generated module is what the Markdown
 * produces, so an invalid or unregenerated article fails `pnpm test`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isSafeHref, liveDatasetKeys, loadArticles, MIN_BODY_WORDS, parseArticle, renderArticleMarkdown } from '../lib/articles.js';
import { ARTICLES_DIR, CANDIDATES_PATH, expectedArticlesModule, GENERATED_PATH } from '../scripts/generate-articles.js';

const LIVE = new Set(['fda-recalls']);
const BODY = `Opening paragraph that answers the question first.\n\n## A section\n\n${'This sentence carries enough plain words to pass the minimum length. '.repeat(20)}`;

function article(frontmatter: string, body = BODY): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

const VALID = 'title: "A valid title"\ndescription: "A short description of the article."\npublishedAt: "2026-09-20"\nauthor: "Data Foundry"';

const directories: string[] = [];
function directoryWith(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'articles-'));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const problemsOf = (frontmatter: string, body = BODY): string => {
  try {
    parseArticle('x.md', 'x', article(frontmatter, body), LIVE);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the article to be refused');
};

describe('article loader', () => {
  it('parses valid frontmatter and renders the body', () => {
    const { frontmatter, article: parsed } = parseArticle('a.md', 'a-valid-article', article(`${VALID}\nupdatedAt: "2026-09-21"\ndataset: fda-recalls`), LIVE);
    expect(frontmatter).toMatchObject({ title: 'A valid title', publishedAt: '2026-09-20', updatedAt: '2026-09-21', dataset: 'fda-recalls' });
    expect(parsed).toMatchObject({ slug: 'a-valid-article', author: 'Data Foundry', updatedAt: '2026-09-21', dataset: 'fda-recalls' });
    expect(parsed.html).toContain('<h2 id="a-section">A section</h2>');
  });

  it.each([
    ['a missing title', VALID.replace(/title: .*\n/, '')],
    ['a missing author', VALID.replace(/\nauthor: .*/, '')],
    ['a missing publishedAt', VALID.replace(/\npublishedAt: .*/, '')],
    ['a title over 70 characters', VALID.replace('A valid title', 'T'.repeat(71))],
    ['a description over 160 characters', VALID.replace('A short description of the article.', 'D'.repeat(161))],
    ['a date that is not YYYY-MM-DD', VALID.replace('2026-09-20', '20 September 2026')],
    ['an impossible date', VALID.replace('2026-09-20', '2026-02-30')],
    ['updatedAt before publishedAt', `${VALID}\nupdatedAt: "2026-09-19"`],
    ['a dataset that is not LIVE', `${VALID}\ndataset: cpsc-recalls`],
    ['a draft flag that is not a boolean', `${VALID}\ndraft: "yes"`],
    ['a title carrying Markdown link syntax', VALID.replace('A valid title', 'Docs](https://example.invalid)[x')],
    ['a multi-line description', VALID.replace('description: "A short description of the article."', 'description: |\n  line one\n  ## injected heading')],
    ['a backtick in the author', VALID.replace('author: "Data Foundry"', 'author: "Data `Foundry`"')],
  ])('refuses %s', (_name, frontmatter) => {
    expect(problemsOf(frontmatter)).toMatch(/frontmatter/);
  });

  it('refuses unknown keys, so a misspelling cannot be silently ignored', () => {
    expect(problemsOf(`${VALID}\nupdatedat: "2026-09-21"`)).toMatch(/updatedat|Unrecognized key/i);
    expect(problemsOf(`${VALID}\ntags: [a, b]`)).toMatch(/tags|Unrecognized key/i);
  });

  it('refuses missing frontmatter, bad YAML, bad slugs and thin bodies', () => {
    expect(() => parseArticle('x.md', 'x', BODY, LIVE)).toThrow(/frontmatter block/);
    expect(problemsOf('title: [unclosed')).toMatch(/not valid YAML/);
    expect(() => parseArticle('Bad_Name.md', 'Bad_Name', article(VALID), LIVE)).toThrow(/slug/);
    expect(problemsOf(VALID, 'Too short.')).toMatch(new RegExp(`at least ${MIN_BODY_WORDS}`));
    expect(problemsOf(VALID, `# A second h1\n\n${BODY}`)).toMatch(/only h1/);
  });

  it('refuses unsafe links, raw HTML and images instead of publishing them quietly', () => {
    expect(problemsOf(VALID, `${BODY}\n\n[click](javascript:alert(1))`)).toMatch(/link target is not allowed/);
    expect(problemsOf(VALID, `${BODY}\n\n<script>alert(1)</script>`)).toMatch(/raw HTML/);
    expect(problemsOf(VALID, `${BODY}\n\n![chart](/chart.png)`)).toMatch(/images are not supported/);
  });

  it('excludes drafts, sorts newest first and fails loudly on any invalid file', () => {
    const directory = directoryWith({
      'older.md': article(VALID.replace('2026-09-20', '2026-09-01')),
      'newer.md': article(VALID.replace('2026-09-20', '2026-09-25')),
      'same-day-b.md': article(VALID.replace('2026-09-20', '2026-09-10')),
      'same-day-a.md': article(VALID.replace('2026-09-20', '2026-09-10')),
      'unfinished.md': article(`${VALID}\ndraft: true`),
    });
    expect(loadArticles(directory, LIVE).map((item) => item.slug)).toEqual(['newer', 'same-day-a', 'same-day-b', 'older']);
    writeFileSync(join(directory, 'broken.md'), article(`${VALID}\nunknown: 1`));
    expect(() => loadArticles(directory, LIVE)).toThrow(/broken\.md/);
    // A draft is validated too: it cannot hide an error until it is published.
    rmSync(join(directory, 'broken.md'));
    writeFileSync(join(directory, 'unfinished.md'), article(`${VALID}\ndraft: true\nunknown: 1`));
    expect(() => loadArticles(directory, LIVE)).toThrow(/unfinished\.md/);
  });

  it('allows only Markdown files in the articles directory, and none at all when it is absent', () => {
    const directory = directoryWith({ 'notes.txt': 'x' });
    expect(() => loadArticles(directory, LIVE)).toThrow(/only <slug>\.md files/);
    expect(loadArticles(join(directory, 'missing'), LIVE)).toEqual([]);
  });
});

describe('article renderer', () => {
  it('strips javascript: and data: links but keeps their text', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x09;script:alert(1)', '&#106;avascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', '//evil.example/x', 'relative/path']) {
      const { html, problems } = renderArticleMarkdown(`[click me](${href})`);
      expect(html, href).not.toMatch(/<a\b/);
      expect(html.toLowerCase(), href).not.toContain('javascript:');
      expect(html, href).not.toContain('data:');
      expect(html, href).toContain('click me');
      expect(problems, href).toHaveLength(1);
    }
    // An autolink goes through the same check.
    expect(renderArticleMarkdown('<javascript:alert(1)>').html).not.toMatch(/<a\b/);
  });

  it('allows http(s), mailto, site-relative paths and anchors, with rel="noopener" on absolute links', () => {
    const { html, problems } = renderArticleMarkdown('[a](https://open.fda.gov) [b](http://example.com) [c](mailto:data@example.com) [d](/recalls/docs) [e](#limits)');
    expect(problems).toEqual([]);
    expect(html).toContain('<a href="https://open.fda.gov" rel="noopener">a</a>');
    expect(html).toContain('<a href="http://example.com" rel="noopener">b</a>');
    expect(html).toContain('<a href="mailto:data@example.com">c</a>');
    expect(html).toContain('<a href="/recalls/docs">d</a>');
    expect(html).toContain('<a href="#limits">e</a>');
    expect(['https://x.test', 'mailto:a@b.test', '/a', '#b'].every(isSafeHref)).toBe(true);
    // Browsers read both of these as another host.
    expect(isSafeHref('//evil.example')).toBe(false);
    expect(isSafeHref('/\\evil.example')).toBe(false);
  });

  it('drops raw HTML, block and inline, rather than passing it through', () => {
    const { html, problems } = renderArticleMarkdown('<div onclick="x()">block</div>\n\nText with <img src=x onerror=alert(1)> inline and <b>bold</b>.');
    expect(html).not.toMatch(/<div|<img|<b>|onerror|onclick/);
    expect(html).toContain('Text with');
    expect(problems).toHaveLength(4);
  });

  it('never renders images', () => {
    const { html } = renderArticleMarkdown('![a chart](https://example.com/chart.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('a chart');
  });

  it('renders fenced code blocks escaped, with their language, for API requests and responses', () => {
    const { html, problems } = renderArticleMarkdown('```json\n{ "a": "<script>&" }\n```\n\n```bash\ncurl "https://api.data.aroqon.com/v1/recalls?state=TX&limit=1"\n```\n\nInline `code` too.');
    expect(problems).toEqual([]);
    expect(html).toContain('<pre><code class="language-json">{ &quot;a&quot;: &quot;&lt;script&gt;&amp;&quot; }\n</code></pre>');
    expect(html).toContain('<pre><code class="language-bash">curl &quot;https://api.data.aroqon.com/v1/recalls?state=TX&amp;limit=1&quot;\n</code></pre>');
    expect(html).toContain('<code>code</code>');
  });

  it('wraps tables so they scroll on a phone and gives headings unique anchors', () => {
    const { html } = renderArticleMarkdown('## Limits\n\n## Limits\n\n| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<h2 id="limits">Limits</h2>');
    expect(html).toContain('<h2 id="limits-2">Limits</h2>');
    expect(html).toMatch(/<div class="table-wrap"><table>[\s\S]*<\/table>\n<\/div>/);
  });
});

describe('committed articles', () => {
  it('are all valid, and the generated Worker module is current (run `pnpm articles:generate`)', () => {
    expect(readFileSync(GENERATED_PATH, 'utf8')).toBe(expectedArticlesModule());
  });

  it('link only to LIVE datasets in the pipeline registry', () => {
    expect(liveDatasetKeys(CANDIDATES_PATH).has('fda-recalls')).toBe(true);
    expect(() => loadArticles(ARTICLES_DIR, new Set())).toThrow(/is not a LIVE key/);
  });
});
