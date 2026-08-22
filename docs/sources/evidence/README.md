# Source review evidence

Bytes retrieved from public endpoints during source review, kept so that claims
in the review packets are **checkable rather than asserted**. Rule 10 applies to
review evidence for the same reason it applies to published facts: a rights
decision nobody can re-derive is a rights decision nobody can audit.

| File | Retrieved | SHA-256 | Source |
| --- | --- | --- | --- |
| `data.energystar.gov-robots.txt` | 2026-08-22T00:40:01Z | `a6c856352c621a97f9fcfb2b212d4fc530169b319c9e7b49fc2e6299d736c7a2` | `https://data.energystar.gov/robots.txt` |
| `energy-star-heat-pumps-sample-3.json` | 2026-08-22T00:40:01Z | `58a30035e9153f9e7258a208988a7280677283258e7ae463ff34b7b2158aeeec` | `https://data.energystar.gov/resource/83eb-xbyy.json?$limit=3` |

## About the sample

Three rows. Not a fixture for the pipeline, and not an ingestion: the smallest
sample that shows the real shape of a record — which fields are populated, how
model numbers are actually formatted, that `ahri_reference_number` is present —
without acquiring a dataset nobody has approved yet.

It is stored here rather than in `verticals/hvac/fixtures/` deliberately.
Fixtures under a vertical are inputs to the pipeline; this is evidence attached
to a review. Moving it is a decision that belongs to whoever approves the
source.

Reproduce:

```bash
curl -s 'https://data.energystar.gov/resource/83eb-xbyy.json?$limit=3'
curl -s https://data.energystar.gov/robots.txt
```
