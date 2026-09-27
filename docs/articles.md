# Publishing an article

Owned articles are served at `https://data.aroqon.com/articles` by the recall
Worker (`apps/recalls-worker`, ADR-0015), which serves `data.aroqon.com` today.
An article is one Markdown file. It goes live in two steps: its pull request is
merged, and then the recall Worker is deployed.

## Where articles live and why

Articles are kept in `content/articles/<slug>.md` at the repository root. They
are not in `docs/`, because `docs/` describes the repository and CI skips it
as documentation-only. They are not in `apps/recalls-worker/`, because
`data.aroqon.com` is the cross-dataset public host (ADR-0012). The Worker
serving it can change, and the content should not have to move when it does.

A Worker has no filesystem. `pnpm articles:generate`
(`tooling/scripts/generate-articles.ts`) validates every file, renders the
Markdown to HTML with `markdown-it`, and writes the published articles to
`apps/recalls-worker/generated/articles.ts`. Commit that generated file with the
article. `markdown-it` runs only at build time and is not part of the Worker
bundle.

## File format

The file name is the URL: `content/articles/fda-recall-api.md` is served at
`/articles/fda-recall-api`. The slug must be lowercase letters, digits and
single hyphens, at most 80 characters.

```markdown
---
title: "FDA Recall API: openFDA enforcement reports, structured"
description: "One or two sentences that state the answer. Shown in search results."
publishedAt: "2026-09-27"
updatedAt: "2026-10-04"
author: "Data Foundry"
dataset: fda-recalls
draft: false
---

The answer first, then `##` sections.
```

| Key | Required | Rule |
| --- | --- | --- |
| `title` | yes | 1–70 characters. The page `<title>`, the `<h1>`, `og:title` and the JSON-LD `headline`. |
| `description` | yes | 1–160 characters. The meta description, `og:description` and the index summary. |
| `publishedAt` | yes | A real date, `YYYY-MM-DD`. Quote it. |
| `updatedAt` | no | A real date, `YYYY-MM-DD`, not earlier than `publishedAt`. Set it only when the substance changed. It is shown as "Updated" and becomes `dateModified`. |
| `author` | yes | 1–100 characters, shown as the byline exactly as written. "Data Foundry", "Data Foundry by Aroqon Data" and "Aroqon Data" are marked up as an Organization. Any other value is marked up as a Person, so use a person's name only with their agreement. |
| `dataset` | no | A key in `docs/sources/pipeline/candidates.yaml` whose `stage` is `LIVE`. For `fda-recalls` the article links to `/recalls` and names the dataset in JSON-LD (`about`). |
| `draft` | no | `true` validates the file but does not publish it. |

`title`, `description` and `author` must each be a single line without `[`, `]`, backticks, `<` or `>`: they are also written into `/llms.txt`, which is Markdown, and those characters would let a value add links or headings there. The Worker escapes them anyway.

Any other key is an error, so a misspelt key cannot be silently ignored.

## Markdown rules

- **No raw HTML.** Tags and HTML comments are errors, and the renderer drops
  them.
- **Links** may be `https:`/`http:`, `mailto:`, site-relative paths (`/recalls/docs`)
  or anchors (`#limits`). Anything else is an error and is rendered as plain
  text. This includes `javascript:`, `data:`, protocol-relative `//host` and
  bare relative paths. Absolute links get `rel="noopener"`.
- **No images.** The rights policy covers images (AGENTS.md rule 9), so they
  are errors.
- **No `#` headings.** The title is the page's only `<h1>`. Use `##` and `###`;
  each gets an `id` from its text, for `#anchor` links.
- **Fenced code blocks** with a language (```` ```bash ````, ```` ```json ````)
  render as `<pre><code class="language-…">`. They are escaped and scroll
  horizontally. Tables are wrapped so they scroll on a phone.
- **At least 150 words** of body text, because AGENTS.md rule 8 forbids thin
  pages.

Every claim must be true of the code and the data at the time of writing.
Build an example request and response from the actual API
(`apps/recalls-worker/src/api.ts`, `src/openapi.ts`), take attribution and
limits from the dataset's rights record, and take prices and sales state from
`src/account.ts`, `wrangler.toml` (`SALES_OPEN`) and ADR-0015. Mark a trimmed
response as trimmed.

## Checks

```bash
pnpm articles:generate                        # validate and write the generated module
pnpm articles:check                           # fail if any article is invalid or the module is stale
npx vitest run tooling/test/articles.test.ts  # loader, renderer, and "the committed module is current"
```

An invalid article fails `pnpm articles:generate`, `pnpm build` and `pnpm test`,
and every problem in the file is listed at once. A pull request that changes
only `content/` still runs full CI verification.

## What the site does with an article

- `/articles` lists published articles, newest `publishedAt` first. With no
  articles it shows an empty state marked `noindex, follow`.
- `/articles/<slug>` renders the article in the site layout with:
  - a canonical URL on `data.aroqon.com`;
  - the title and meta description;
  - Open Graph `article` tags;
  - `Article` JSON-LD whose `author`, `datePublished` and `dateModified` match
    the visible byline and dates.

  No FAQPage markup is emitted. An unknown slug returns the site's 404 page.
- Both are served on the public host only; `api.data.aroqon.com` returns 404.
  They are cached like the other static pages (`Cache-Control: public,
  max-age=300`). Articles are bundled content rather than dataset rows, so
  `SOURCE_KILL_SWITCH` does not withdraw them.
- `/sitemaps/pages.xml` (in the `/sitemap.xml` index) lists `/articles` and
  every published article with its last-modified date, and `/llms.txt` and
  `/llms-full.txt` gain an "Articles" section.
- **IndexNow is not triggered for articles.** The only IndexNow submission
  today runs after the scheduled recall sync, and it announces changed recall
  pages only. A new article is found through the sitemap and the site links.

## Getting it live

1. Open a pull request that adds `content/articles/<slug>.md` and the
   regenerated `apps/recalls-worker/generated/articles.ts`.
2. After CI passes, merge it.
3. Deploy the recall Worker from the merged `main`: `wrangler deploy` in
   `apps/recalls-worker`. Merging does not deploy, and the `deploy-production`
   workflow does not deploy this Worker (ADR-0015). Until an operator deploys,
   the article is on `main` but not on the site.
