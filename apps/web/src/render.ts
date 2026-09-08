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
      : // JSON.stringify does not escape `<`, so a value containing the text
        // `</script>` would close the element early and turn the remainder of
        // the JSON into markup. `\uXXXX` escapes stay valid JSON, so a parser
        // reads the same object; only the raw HTML-significant bytes change.
        `<script type="application/ld+json">${JSON.stringify(options.structuredData)
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e')
          .replace(/&/g, '\\u0026')}</script>`;

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
*{box-sizing:border-box}html{background:#f4f7f8}body{font-family:system-ui,-apple-system,sans-serif;max-width:76rem;margin:0 auto;padding:2rem;line-height:1.6;color:#183343}h1{font-size:clamp(2rem,4vw,3.5rem);line-height:1.12;letter-spacing:-.04em;max-width:20ch}h2{line-height:1.25;margin-top:2rem}a{overflow-wrap:anywhere}p{max-width:78ch}main{min-height:65vh}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e8eff1;padding:1rem;border-radius:.5rem}code{font-size:.9em}input,select,button{font:inherit;padding:.65rem;border:1px solid #a8bbc3;border-radius:.3rem;max-width:100%}label{display:block}select{display:block;min-width:12rem}button,.button{background:#12676b;color:white;border:0;border-radius:.35rem;padding:.8rem 1.2rem;text-decoration:none;font-weight:600;display:inline-block;cursor:pointer}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #da8e36;outline-offset:3px}.secondary{background:#e1eeee;color:#17464f}.hero{padding:2rem 0 1rem}.eyebrow{text-transform:uppercase;letter-spacing:.09em;font-size:.8rem;font-weight:700;color:#306572}.lede{font-size:1.3rem;max-width:54ch}.actions,.product-nav,.pagination{display:flex;gap:1rem;flex-wrap:wrap;align-items:center}.product-nav{border-bottom:1px solid #ccdadd;padding-bottom:1rem;margin:1.3rem 0}.product-nav a{font-weight:600}.plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem}.plan{background:white;padding:1.4rem;border:1px solid #ccdadd;border-radius:.55rem}.plan h2{margin-top:0}.price{font-size:2rem;font-weight:700}.price span{font-size:.9rem;font-weight:400}.filter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:1rem}.filters{margin:1rem 0;max-width:100%}.filters summary{cursor:pointer;font-weight:600}.filters fieldset{border:1px solid #ccdadd;border-radius:.4rem;min-width:0}.filters input,.filters select{width:100%}.results{list-style:none;padding:0}.result{background:white;border:1px solid #d8e2e5;border-radius:.35rem;padding:1rem;margin:.65rem 0}.result>a{font-weight:650}.result .evidence{display:block}.pagination{justify-content:space-between;margin:1.5rem 0}.site-header{font-weight:750;letter-spacing:-.02em;padding-bottom:1rem}.site-header a{text-decoration:none;color:#183343}@media(max-width:600px){body{padding:1rem}h1{font-size:2.1rem}.product-nav{gap:.8rem;font-size:.9rem}.plan-grid{grid-template-columns:1fr}th,td{padding:.4rem;font-size:.84rem;overflow-wrap:anywhere}.actions>a{width:100%;text-align:center}nav[aria-label="Breadcrumb"] ol{flex-wrap:wrap}}
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
.artifact-reference{overflow-wrap:anywhere;max-width:100%;font-size:.75rem}.artifact-reference dt{font-weight:600}.artifact-reference dd{margin:0 0 .4rem}
@media(max-width:600px){.fact-table,.fact-table tbody{display:block}.fact-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.fact-table tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.4rem;border:1px solid #ccdadd;border-radius:.4rem;padding:.75rem;margin:.75rem 0;background:white}.fact-table tbody th,.fact-table td{display:block;border:0;padding:.2rem;overflow-wrap:anywhere}.fact-table td:nth-child(3){grid-column:1/-1}.fact-table .evidence ul{padding-left:1.2rem}}
.facts dt{font-weight:600}
.facts dd{margin:0 0 .75rem 0}
</style>
</head>
<body>
<header class="site-header"><a href="/">Data Foundry</a></header><main>
${crumbs}
${options.bodyHtml}
</main><footer>
<p>Data Foundry — evidence-backed data, every value cites its source. <a href="/">All industries</a></p>
</footer>
</body>
</html>`;
}

export function renderList(items: readonly string[]): string {
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}
