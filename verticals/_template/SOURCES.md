# Sources — `template`

> Replace this file. It is the human-readable companion to `sources/*.yaml`:
> the YAML is what the machine enforces, this is what the next engineer reads
> before touching a connector.

## Source inventory

| Key | Publisher | Type | Authority | Format | Acquisition | Rights | Status | Cadence |
|---|---|---|---|---|---|---|---|---|
| `example-source` | REPLACE_ME | OTHER | 50 | REPLACE_ME | DIRECT_HTTP | UNREVIEWED | PROPOSED | MONTHLY |

## Source families

A vertical requires **at least 3 materially independent source families**.
Independent means a different organization with a different incentive — three
mirrors of the same upstream feed are one family, not three. State the families
plainly and name what each one uniquely provides.

| Family | Sources | Uniquely provides |
|---|---|---|
| REPLACE_ME | | |

## Per-source notes

### `example-source`

- **What it is:** REPLACE_ME
- **Why we need it:** what it provides that no other source does. If the answer
  is "nothing", the source should not be here.
- **Format and quirks:** the specific messiness this source contributes —
  identifier formatting, unit choices, fields it omits.
- **Known conflicts:** which properties it disagrees with other sources about,
  and who wins.
- **Failure modes:** what breaks when this source changes shape, and what the
  extraction contract test catches.

## Synthetic vs. real sources

If any source in this vertical is **synthetic** — fabricated for testing rather
than acquired from a real publisher — say so here explicitly, in this section,
in plain language. Name which sources are synthetic and which are real.

Synthetic sources must use reserved example domains (`example.com`,
`example.org`, `example.net` — RFC 2606) and fictional publishers, so that no
crawl of a fixture can ever reach a real third party. Never attribute a
fabricated feed to a real company: that invents a rights claim about an
organization that never made one.
