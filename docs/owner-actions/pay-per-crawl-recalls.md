# Cloudflare Pay Per Crawl for data.aroqon.com: owner steps

**Status (2026-09-28): unknown enrollment, not configured by this repository.** Cloudflare's documentation (updated 2026-07-28) still describes Pay Per Crawl as a **closed beta**. The last recorded check was 2026-09-16 (`UA-008`), and no admission has been recorded since. No session so far has had zone-level access to read the AI Crawl Control settings, so enrollment is unknown, not "off". Crawler billing is not active on the evidence available. Crawler access rules and prices are unchanged, and changing them needs the owner's approval.

## Steps (owner, Cloudflare dashboard)

1. **Request admission.** Use <https://www.cloudflare.com/paypercrawl-signup/>, or your account executive on Enterprise. Record the decision under `UA-008`.
2. **After admission: account visibility.** Account Settings → Pay Per Crawl: set the `aroqon.com` domain's visibility to **Visible**.
3. **Price.** Go to AI Crawl Control → Payments → Pay Per Crawl → **Enable**, and set a default price. The minimum is $0.001 per crawl, charged per successful (HTTP 200) retrieval. The price is an owner decision; this repository proposes none.
4. **Keep the API and machine files out of crawl charging.** Add a Configuration Rule with **Disable Pay Per Crawl** for `api.data.aroqon.com/*`, because API access is sold through keys and RapidAPI and must not be billed twice. Consider the same for `/llms.txt`, `/llms-full.txt`, `/docs` and the catalog, which drive discovery. Cloudflare always leaves `/robots.txt` and `/sitemap.xml` free.
5. **Select crawlers to charge**, then connect payouts (Stripe, through Cloudflare as Merchant of Record).
6. **Check the rules.** WAF and Bot Management block rules override charging, so a crawler blocked there is never charged. AI-crawler blocking on the zone was disabled as of 2026-09-27.

## Evidence that it is live

It is live when a verified AI crawler without payment intent receives HTTP 402 with a `crawler-price` header on a public notice page, and AI Crawl Control → Payments shows charged crawls. Until both are observed, report crawler billing as not active.

Crawler payment settings never widen upstream source rights (AGENTS.md). The product-recall and FDA rights records permit public web access. Rule 8 (no thin pages) still governs which pages are indexable.
