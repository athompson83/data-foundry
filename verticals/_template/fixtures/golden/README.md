# Golden records

Expected canonical output for this vertical's fixtures. This directory is the
contract the pipeline is measured against.

Per doc 14, a golden record set specifies, for each representative entity:
identity, critical facts, relationships, source evidence, display fields and
filters.

## Files

| File | Contents |
|---|---|
| `entities.json` | Expected canonical entities and their aliases, including the normalized join keys |
| `facts.json` | Expected facts — **including claims that lose fact selection**, with the status and reason they lost |
| `relationships.json` | Expected graph edges with their evidence |

## Why losing claims belong here

A golden file that records only the winning value tests half the system. The
question a user actually asks is *"why does your site say X when the brochure
says Y?"*, and answering it requires the losing claim, its evidence, and the
rule that demoted it. Doc 04: *"Do not overwrite conflicting facts prematurely."*

Record, for every conflict:

- both claims and their sources;
- which won;
- **which criterion decided it** (doc 04's six, by name);
- the status assigned to the loser.

## Changing a golden file

A golden file changes only when the canonical model changes — never to make a
failing test pass. Record the reason in `CHANGELOG.md` alongside the
`schema_version` bump.
