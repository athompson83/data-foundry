/**
 * Owned articles for data.aroqon.com/articles (docs/articles.md).
 *
 * Articles are Markdown files in `content/articles/<slug>.md`. A Worker has no
 * filesystem, so `tooling/scripts/generate-articles.ts` validates every file
 * here and bakes the published ones into `apps/recalls-worker/generated/articles.ts`
 * as already-rendered HTML. Rendering at build time keeps the Markdown parser
 * out of the Worker bundle, and means a bad article fails `pnpm test` and the
 * generator rather than a production request.
 *
 * Safety is enforced twice: the renderer never emits raw HTML, unsafe links or
 * images whatever it is given, and the loader refuses a file that contains any
 * of them, so an author finds out instead of watching content vanish.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** The fields the Worker receives for one published article. */
export interface GeneratedArticle {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly publishedAt: string;
  readonly updatedAt: string | null;
  readonly author: string;
  readonly dataset: string | null;
  readonly html: string;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 80;
/** Rule 8 (no thin pages): an article that says less than this is a stub, not an article. */
export const MIN_BODY_WORDS = 150;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const IsoDate = z.string().refine(isCalendarDate, 'must be a real date written YYYY-MM-DD');
// These values are also interpolated into llms.txt, which is Markdown: a bracket, backtick, angle bracket
// or line break would let frontmatter add links or headings there while the HTML page stayed valid.
const Text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'is required')
    .max(max, `must be at most ${max} characters`)
    .refine((value) => !/[\r\n]/.test(value), 'must be a single line')
    .refine((value) => !/[[\]`<>]/.test(value), 'must not contain [ ] ` < or >');

/** Unknown keys are refused, so a misspelt `updatedat` fails instead of being ignored. */
export const ArticleFrontmatter = z
  .object({
    title: Text(70),
    description: Text(160),
    publishedAt: IsoDate,
    updatedAt: IsoDate.optional(),
    author: Text(100),
    dataset: z.string().regex(SLUG_PATTERN, 'must be a candidate key').optional(),
    draft: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.updatedAt === undefined || value.updatedAt >= value.publishedAt, {
    message: 'must not be earlier than publishedAt',
    path: ['updatedAt'],
  });

export type ArticleFrontmatter = z.infer<typeof ArticleFrontmatter>;

export class ArticleError extends Error {
  constructor(file: string, problems: readonly string[]) {
    super(`${file}:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ArticleError';
  }
}

/** http(s) and mailto, a site-relative path, or an in-page anchor. Everything else is refused. */
export function isSafeHref(href: string): boolean {
  if (href.startsWith('#')) return true;
  // "//host" and "/\host" are protocol-relative in browsers, so neither is site-relative.
  if (href.startsWith('/')) return !/^\/[/\\]/.test(href);
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function isAbsoluteWeb(href: string): boolean {
  return /^https?:/i.test(href);
}

interface RenderEnv {
  problems: string[];
  skipLinkClose: boolean;
  headingIds: Set<string>;
}

function headingId(text: string, used: Set<string>): string {
  const base = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
}

function createRenderer(): MarkdownIt {
  // `html: true` so raw HTML is parsed into its own tokens, which the rules
  // below drop and report; with it off, a stray tag would silently render as text.
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  // Every link reaches link_open, where the one allow-list is applied. The
  // default validator would leave a refused link behind as literal "[text](url)".
  md.validateLink = () => true;
  const rules = md.renderer.rules;
  const env = (value: unknown) => value as RenderEnv;

  rules.html_block = (tokens, index, _options, context) => {
    env(context).problems.push(`raw HTML is not allowed: ${JSON.stringify((tokens[index] as Token).content.trim().slice(0, 60))}`);
    return '';
  };
  rules.html_inline = (tokens, index, _options, context) => {
    env(context).problems.push(`raw HTML is not allowed: ${JSON.stringify((tokens[index] as Token).content.slice(0, 60))}`);
    return '';
  };
  rules.image = (tokens, index, _options, context, self) => {
    const token = tokens[index] as Token;
    env(context).problems.push(`images are not supported (rights policy, AGENTS.md rule 9): ${JSON.stringify(token.attrGet('src') ?? '')}`);
    return md.utils.escapeHtml(self.renderInlineAsText(token.children ?? [], md.options, context));
  };
  rules['link_open'] = (tokens, index, options, context, self) => {
    const token = tokens[index] as Token;
    const href = token.attrGet('href') ?? '';
    if (!isSafeHref(href)) {
      env(context).problems.push(`link target is not allowed (use https:, mailto:, /path or #anchor): ${JSON.stringify(href.slice(0, 80))}`);
      env(context).skipLinkClose = true;
      return '';
    }
    if (isAbsoluteWeb(href)) token.attrSet('rel', 'noopener');
    return self.renderToken(tokens, index, options);
  };
  rules['link_close'] = (tokens, index, options, context, self) => {
    if (env(context).skipLinkClose) {
      env(context).skipLinkClose = false;
      return '';
    }
    return self.renderToken(tokens, index, options);
  };
  rules['heading_open'] = (tokens, index, options, context, self) => {
    const token = tokens[index] as Token;
    if (token.tag === 'h1') env(context).problems.push('use ## for sections: the title is the page\'s only h1');
    const inline = tokens[index + 1] as Token | undefined;
    token.attrSet('id', headingId(inline?.children ? self.renderInlineAsText(inline.children, options, context) : '', env(context).headingIds));
    return self.renderToken(tokens, index, options);
  };
  // Wide tables scroll inside the column instead of widening the page on a phone.
  rules['table_open'] = (tokens, index, options, _context, self) => `<div class="table-wrap">${self.renderToken(tokens, index, options)}`;
  rules['table_close'] = (tokens, index, options, _context, self) => `${self.renderToken(tokens, index, options)}</div>`;
  return md;
}

const renderer = createRenderer();

/**
 * Markdown to HTML with no raw HTML, no images and only allowed link targets.
 * Whatever is refused is left out of the HTML and listed in `problems`.
 */
export function renderArticleMarkdown(markdown: string): { html: string; problems: string[] } {
  const env: RenderEnv = { problems: [], skipLinkClose: false, headingIds: new Set() };
  const html = renderer.render(markdown, env);
  return { html, problems: env.problems };
}

export function wordCount(html: string): number {
  return html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Split `---\n<yaml>\n---\n<body>`. */
function splitFrontmatter(source: string): { yaml: string; body: string } | null {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(text);
  return match ? { yaml: match[1] as string, body: match[2] as string } : null;
}

export interface ParsedArticle {
  readonly frontmatter: ArticleFrontmatter;
  readonly article: GeneratedArticle;
}

/**
 * Validate and render one article. `liveDatasets` is the set of candidate keys
 * at stage LIVE; a `dataset` outside it is refused. Throws `ArticleError`
 * listing every problem at once.
 */
export function parseArticle(file: string, slug: string, source: string, liveDatasets: ReadonlySet<string>): ParsedArticle {
  const problems: string[] = [];
  if (!SLUG_PATTERN.test(slug) || slug.length > MAX_SLUG_LENGTH) problems.push(`file name must be <slug>.md with a lowercase, hyphenated slug of at most ${MAX_SLUG_LENGTH} characters`);
  const parts = splitFrontmatter(source);
  if (!parts) throw new ArticleError(file, [...problems, 'must start with a --- frontmatter block closed by ---']);
  let raw: unknown;
  try {
    raw = parseYaml(parts.yaml);
  } catch (error) {
    throw new ArticleError(file, [...problems, `frontmatter is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`]);
  }
  const parsed = ArticleFrontmatter.safeParse(raw ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`frontmatter ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  } else if (parsed.data.dataset !== undefined && !liveDatasets.has(parsed.data.dataset)) {
    problems.push(`frontmatter dataset: "${parsed.data.dataset}" is not a LIVE key in docs/sources/pipeline/candidates.yaml`);
  }
  const { html, problems: renderProblems } = renderArticleMarkdown(parts.body);
  problems.push(...renderProblems);
  const words = wordCount(html);
  if (words < MIN_BODY_WORDS) problems.push(`body has ${words} words; an article needs at least ${MIN_BODY_WORDS} (AGENTS.md rule 8: no thin pages)`);
  if (problems.length > 0 || !parsed.success) throw new ArticleError(file, problems);
  const frontmatter = parsed.data;
  return {
    frontmatter,
    article: {
      slug,
      title: frontmatter.title,
      description: frontmatter.description,
      publishedAt: frontmatter.publishedAt,
      updatedAt: frontmatter.updatedAt ?? null,
      author: frontmatter.author,
      dataset: frontmatter.dataset ?? null,
      html,
    },
  };
}

/** Candidate keys at stage LIVE in the dataset pipeline registry. */
export function liveDatasetKeys(registryPath: string): Set<string> {
  const registry = parseYaml(readFileSync(registryPath, 'utf8')) as { candidates?: ReadonlyArray<{ key?: unknown; stage?: unknown }> };
  return new Set((registry.candidates ?? []).filter((candidate) => candidate.stage === 'LIVE' && typeof candidate.key === 'string').map((candidate) => candidate.key as string));
}

/** Newest first; a stable tie-break so the generated module does not churn. */
export function sortArticles(articles: readonly GeneratedArticle[]): GeneratedArticle[] {
  return [...articles].sort((a, b) => (a.publishedAt === b.publishedAt ? a.slug.localeCompare(b.slug) : a.publishedAt < b.publishedAt ? 1 : -1));
}

/**
 * Every published article in `directory`, newest first. Drafts are validated
 * like any other article and then left out. A missing directory means none.
 */
export function loadArticles(directory: string, liveDatasets: ReadonlySet<string>): GeneratedArticle[] {
  if (!existsSync(directory)) return [];
  const published: GeneratedArticle[] = [];
  const errors: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (!name.endsWith('.md') || !statSync(path).isFile()) {
      errors.push(`${path}:\n  - only <slug>.md files belong in the articles directory`);
      continue;
    }
    try {
      const { frontmatter, article } = parseArticle(path, name.slice(0, -3), readFileSync(path, 'utf8'), liveDatasets);
      if (frontmatter.draft !== true) published.push(article);
    } catch (error) {
      if (!(error instanceof ArticleError)) throw error;
      errors.push(error.message);
    }
  }
  if (errors.length > 0) throw new Error(`Invalid article(s):\n${errors.join('\n')}`);
  return sortArticles(published);
}

export function serializeArticlesModule(articles: readonly GeneratedArticle[]): string {
  return [
    '/**',
    ' * Generated by tooling/scripts/generate-articles.ts from content/articles/*.md.',
    ' * Do not edit by hand: change the Markdown and run `pnpm articles:generate`.',
    ' */',
    "import type { Article } from '../src/articles.js';",
    '',
    `export const ARTICLES: readonly Article[] = ${JSON.stringify(articles, null, 2)};`,
    '',
  ].join('\n');
}
