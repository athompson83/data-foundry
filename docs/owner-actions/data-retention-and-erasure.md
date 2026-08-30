# Owner actions — retention and erasure for customer data

`db/migrations/0011_api_tenancy.sql` introduces the first tables in this schema
that describe a **person or company that pays**, rather than the knowledge graph.
That changes what deletion means, and the schema deliberately does not decide it.

Raised in review of #12. Recorded here rather than guessed at in DDL, because
retention periods are a legal and commercial choice with jurisdictional answers,
and a number invented by an engineer is worse than no number.

## What the schema currently guarantees

`api_usage_events` references both `api_tenants` and `api_keys` with
`ON DELETE RESTRICT`. The reasoning is `fact_evidence`'s: the record of what
happened outlives the convenience of removing it, and a usage row whose key has
been deleted cannot explain the invoice it supports.

The consequence, stated plainly: **once a tenant has used the API, no `DELETE`
against that tenant or its keys will succeed.** That is intentional for invoice
integrity. It is not, on its own, an erasure policy.

## Why this is not automatically a GDPR problem

`ON DELETE RESTRICT` is not a violation. Retaining billing records for a
documented legal, tax or contractual period is a recognised basis for keeping
data, and erasure rights are not absolute where such a basis applies.

What *would* be a problem is having no policy at all — retaining contact details
indefinitely because the schema happens to make removal awkward, and discovering
the question when somebody asks to be erased.

## The decision to make, before customer data exists in volume

Four parts, and only the first is technical:

1. **What identifies a person here?** `api_tenants.contact_email` is the obvious
   one. `name` and `slug` may be a sole trader's name. Usage rows carry no
   direct personal data by design — the route-template constraints exist so
   that what a named customer *looked up* never lands in the metering table.
   Direct, RapidAPI, and MCP events use closed access/billing classifications;
   MCP tool arguments and concrete REST targets are excluded, and RapidAPI/MCP
   rows are analytics-only for Data Foundry invoicing.
2. **How long do metering rows have to live?** Pick from the actual obligation —
   tax retention, contractual dispute windows, fraud investigation — not from
   "it might be useful". Write the period and its basis down.
3. **What happens at closure?** Close-and-pseudonymise is one possible
   engineering pattern, not the policy: an approved controller policy could set
   `api_tenants.status = 'CLOSED'`, null or tokenise `contact_email` and other
   direct identifiers, and retain the anchor row for usage history. Before that
   pattern can be adopted, the controller must document the legal basis and
   jurisdiction-specific requirements, analyse whether the remaining data can
   be re-identified or linked back to a person, and verify the implemented
   transformation and downstream copies. Pseudonymisation alone does **not**
   establish that an erasure request has been satisfied, and it is not a claim
   that the retained data is anonymous.
4. **What happens after the retention period?** Delete or anonymise the usage
   rows. This is the only part that needs new code — a scheduled job, and a
   migration if `ON DELETE RESTRICT` has to be worked around for the anchor row.

## What must not be used for this

**Do not hard-delete an API key for ordinary revocation.** `revoked_at` is the
operational state and exists precisely so that a withdrawn key still explains
its own history. A key deleted to "clean up" takes the audit trail with it, and
`ON DELETE RESTRICT` will refuse anyway once the key has been used.

## Verify

Once the policy exists, it belongs somewhere a customer can read it — a privacy
notice — and somewhere an operator can execute it. It must cover direct API,
marketplace, and MCP analytics consistently. This document is neither; it is
the record that the decision is open.
