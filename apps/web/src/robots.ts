/**
 * `robots.txt` — one global file, deliberately.
 *
 * Per-page indexability is already decided per-request via `<meta
 * name="robots">` (`gates.ts` + `pages.ts`), so `robots.txt` here does not
 * disallow anything: doing both would let the two disagree, and a crawler
 * that obeys `robots.txt` would never even fetch the page whose meta tag was
 * the actual, gate-computed decision. This file's only job is pointing at the
 * sitemap index and naming the AI-crawler split
 * `docs/owner-actions/cloudflare-deployment.md` records as an owner action
 * (pay per crawl is a Cloudflare zone setting, not something this file can
 * express — see item 4 there).
 */
export function robotsTxt(deployment: { readonly publicOrigin: string }): string {
  return `User-agent: *
Allow: /

Sitemap: ${deployment.publicOrigin}/sitemap-index.xml
`;
}
