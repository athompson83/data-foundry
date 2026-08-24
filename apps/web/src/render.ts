/**
 * Minimal, framework-free HTML rendering.
 *
 * No client-side JavaScript, deliberately: the manual-query UI is a plain
 * `<form method="get">`, so a crawler, an `llms.txt`-reading agent and a
 * person with JavaScript disabled all see the same content a person with a
 * full browser does. That is also what keeps `min_unique_content_words`
 * measuring the same thing a search engine's renderer would see.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

export interface LayoutOptions {
  readonly title: string;
  readonly description: string;
  readonly canonicalUrl: string;
  readonly robots: string;
  readonly structuredData?: unknown;
  readonly bodyHtml: string;
  readonly breadcrumbs?: readonly { readonly label: string; readonly href: string }[];
}

/**
 * One shell for every page. A single place that emits `<meta name="robots">`
 * and `<link rel="canonical">` is what makes "every page states its own
 * indexability" a property of the layout rather than a discipline each page
 * author has to remember (doc 07).
 */
export function layout(options: LayoutOptions): string {
  const jsonLd =
    options.structuredData === undefined
      ? ''
      : `<script type="application/ld+json">${JSON.stringify(options.structuredData)}</script>`;

  const crumbs =
    options.breadcrumbs === undefined || options.breadcrumbs.length === 0
      ? ''
      : `<nav aria-label="Breadcrumb"><ol>${options.breadcrumbs
          .map(
            (c, i) =>
              `<li>${
                i === options.breadcrumbs!.length - 1
                  ? escapeHtml(c.label)
                  : `<a href="${escapeAttr(c.href)}">${escapeHtml(c.label)}</a>`
              }</li>`,
          )
          .join('')}</ol></nav>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<meta name="description" content="${escapeAttr(options.description)}">
<link rel="canonical" href="${escapeAttr(options.canonicalUrl)}">
<meta name="robots" content="${escapeAttr(options.robots)}">
<meta property="og:title" content="${escapeAttr(options.title)}">
<meta property="og:description" content="${escapeAttr(options.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeAttr(options.canonicalUrl)}">
${jsonLd}
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:72rem;margin:0 auto;padding:1.5rem;line-height:1.5;color:#1a1a1a}
a{color:#0b5fff}
nav[aria-label="Breadcrumb"] ol{list-style:none;display:flex;gap:.5rem;padding:0;font-size:.875rem;color:#666}
nav[aria-label="Breadcrumb"] li:not(:last-child)::after{content:"›";margin-left:.5rem;color:#999}
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #e5e5e5}
.notice{background:#fff8e6;border:1px solid #e6c757;border-radius:.375rem;padding:.75rem 1rem;margin:1rem 0}
.evidence{font-size:.8125rem;color:#555}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #e5e5e5;font-size:.8125rem;color:#666}
form.search input[type=search]{padding:.5rem;font-size:1rem;width:20rem;max-width:100%}
form.search button{padding:.5rem 1rem;font-size:1rem}
.facts dt{font-weight:600}
.facts dd{margin:0 0 .75rem 0}
</style>
</head>
<body>
${crumbs}
${options.bodyHtml}
<footer>
<p>Data Foundry — evidence-backed data, every value cites its source. <a href="/">All industries</a></p>
</footer>
</body>
</html>`;
}

export function renderList(items: readonly string[]): string {
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}
