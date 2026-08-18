# Golden records — `hvac`

Expected canonical output from the four fixtures. This directory is the contract
the pipeline is measured against.

| File | Contents |
|---|---|
| `entities.json` | 27 entities (3 manufacturers, 13 equipment models, 11 certifications) with aliases and normalized join keys, plus **3 negative resolution judgments** |
| `facts.json` | 171 facts — 169 `ACTIVE`, **2 `SUPERSEDED`** — each with evidence and the selection criterion that decided it |
| `relationships.json` | 26 edges, plus **expected traversals** and **expected absences** |

## Counts

| | Count |
|---|---:|
| Manufacturers | 3 |
| Equipment models | 13 |
| Certifications | 11 |
| Facts (equipment_model) | 113 |
| Facts (certification) | 58 |
| Facts with evidence | **171 / 171 (100%)** |
| `manufactures` edges | 13 |
| `supersedes` edges | 2 |
| `certified_by` edges | 11 |
| `compatible_with` edges | **0 (asserted)** |

## Why losing claims are in here

A golden file that records only the winning value tests half the system.

The question a user actually asks is *"why does your site say 14.3 when the
brochure says 14.5?"*, and answering it needs the losing claim, its evidence, and
the rule that demoted it. Doc 04: *"Do not overwrite conflicting facts
prematurely."*

Every conflict records both claims, which won, **which of doc 04's six criteria
decided it** (`selected_by` / `lost_because`), and the status assigned to the
loser.

## Assertions that are absences

Three expectations here are about what must **not** be produced. They are easy to
overlook and expensive to get wrong:

1. **`compatible_with` must have zero edges.** No source asserts compatibility,
   inference is forbidden, transitive closure is forbidden. Any edge produced
   from these fixtures is a fabricated safety- and warranty-relevant claim.
2. **The two discontinued models must have no `certified_by` edge.** Directories
   drop withdrawn models. Back-filling from an older export without saying so
   asserts a currently-valid certification that does not exist.
3. **Three entity pairs must never merge** — two supersession pairs that blocking
   will certainly propose, and one cross-manufacturer spec collision. Recorded as
   durable negative judgments (doc 06) so they are never re-proposed.

## Expected traversals

`relationships.json` carries the supersession traversals with their expected
paths. The load-bearing one:

```text
find_replacement_model("24ACA636A003")
  → 24ACA636A003 → 24ACB636A003 → 24ACC636A003
  → 2 hops, terminal 24ACC636A003, refrigerant changed R-410A → R-454B
```

A one-hop answer returns `24ACB636A003`, which is itself discontinued. It looks
right and is wrong — the failure this vertical exists to prevent.

Note also the zero-hop case: `find_replacement_model("24ACC636A003")` must return
*"this model is current"*, never an empty result. An empty result reads as "no
data" and sends the user elsewhere.

## Entity refs

`ref` is a stable test handle of the form `entity_type:normalized_identifier` —
not a database id. It uses the **normalized** identifier, which is why Borealis
models appear as `equipment_model:BTWC2036` rather than `BTW-C2036`.

## Changing these files

Only when the canonical model changes. **Never to make a failing test pass.**
Record the reason in `../../CHANGELOG.md` alongside the `schema_version` bump.

Identifier normalization changes are always breaking: they re-key every entity
in the vertical.
