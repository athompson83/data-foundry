# Conversion-first go-to-market choices — 2026-09-26

**Authority:** the Product Owner delegated the choice ("select whichever option has best chances for conversion"). These are engineering/commercial judgments made on that delegation. They are not measured results. Revisit them after the first 30 days of real funnel data.

| Choice | Selected | Why it converts better | Alternative kept |
| --- | --- | --- | --- |
| Lead channel | **RapidAPI marketplace** | It has existing developer search traffic, a trusted one-click subscription, built-in free-tier trials, and billing/tax handled by the marketplace. A new direct site starts with zero traffic. | Direct Stripe self-service (ADR-0014) for larger customers and site visitors |
| Entry pricing | **Free BASIC (100 req/mo) + $9 Starter (1,000 req/mo)** ahead of $49 / $149 / $299 | Developers test before paying. A $9 step captures hobby and small-shop buyers who stall at $49. | The existing four-tier ladder stays above the entry tiers |
| Headline product | **VIN → open recalls (with decoded vehicle and fuel economy)** | "VIN recall API" is the query developers search for and the job they will pay for per lookup. Make/model/year browsing is supporting value. | Make/model/year lookups remain available |
| Overage | **Hard stop (unchanged)** | Machine clients fear surprise bills. The upgrade path is one click (portal / marketplace plan change). | — |

## Consequences for the build

1. **RapidAPI is on the critical path to first revenue.** `UA-004` (owner enrollment, marketplace agreement, payout, plan setup) is the highest-leverage owner action. The canonical adapter and marketplace OpenAPI projection already exist.
2. **The free tier is served through RapidAPI's free plan, not self-issued free keys.** That avoids building email verification and abuse controls before there is demand. The direct `API_FREE` channel stays unbuilt.
3. **The vehicles `product.yaml` should list Starter ($9 / 1,000) between Evaluate and Developer.** Stripe needs a matching Starter price per mode.
4. **The VIN lookup** needs vPIC decode data or a per-request decode path. Its design is part of the vehicles build once source access (`UA-009`) exists.
