# DOE supported-access inquiry — reduced to one send authorization

**Owner direction:** *"Authorize preparation/sending of the supported-access
inquiry once sender identity and contact route are confirmed."*

**Neither condition is met.** The inquiry is prepared; it is not sent; and it
reduces to a single authorization plus two facts only the owner can supply.

## Why this did not proceed to sending

**The contact route cannot be confirmed from here.** The route the draft names
is the publisher's own contact page, and it refuses this environment:

```
https://www.regulations.doe.gov/ccms/help/help-and-contact-information   403
https://www.regulations.doe.gov/ccms                                     403
https://www.regulations.doe.gov/robots.txt                               403
```

Measured 2026-09-16 with the honest agent `data-foundry-research`. The site
returns 403 even for `robots.txt`, so its contact details cannot be read without
impersonating a browser — the method the owner has already ruled out for
production, and not one to adopt merely to find an address.

**The addresses that *are* reachable are the wrong ones.** `energy.gov/contact-us`
serves normally and publishes `DOENews@hq.doe.gov`, `The.Secretary@hq.doe.gov`
and `clearinghouse@oro.doe.gov`. These are press, executive and a site-specific
clearinghouse — **not** the CCMS program. Sending a technical data-access
inquiry to any of them would be misrouted, and picking one to satisfy a checkbox
would be worse than not sending.

**Sender identity is blank by design.** The draft asserts no name, title,
organisation or address. I cannot supply those: an identity asserted on the
project's behalf to a federal agency is the owner's to give, not mine to invent.

## What is ready

The inquiry itself is complete and needs no drafting work:
[`docs/sources/doe-ccms-access-inquiry-draft.md`](../sources/doe-ccms-access-inquiry-draft.md).

It asks three questions — is there a documented bulk download, export or API; if
not, is automated querying of the public interface acceptable and at what rate;
and what attribution or disclaimer requirements apply. It already records that **no CCMS dataset
appears in data.gov's advertised sitemap** (all 112 shards, 559,455 URLs). That
is absence from the sitemap, not proof no catalogue record exists — the
catalogue's API and search are broken and it appears mid-rebuild — so the first
question is asked from evidence rather than from not having looked, and remains
genuinely open.

## The single authorization

> **Authorize sending the prepared DOE CCMS supported-access inquiry, supplying
> (a) the sender identity to use and (b) the contact route.**

On (b), one of these, in order of preference:

1. A CCMS program contact the owner can reach — read from the contact page in an
   ordinary browser, which this environment cannot use.
2. The EERE Appliance and Equipment Standards program route, via
   `energy.gov/eere/buildings/appliance-and-equipment-standards-program`, which
   **does** serve this environment (HTTP 200) and is topically correct.
3. A general DOE route as a last resort, accepting it will likely be forwarded
   or dropped.

## What happens either way

Authorizing this does not activate CCMS and does not change its posture. CCMS
remains unselectable on acquisition grounds regardless of the answer, and a
favourable reply would open a *new* qualification path rather than complete the
existing one. It is worth sending because a supported extract would complement
whichever first source is chosen — not because it unblocks anything now.

**Nothing has been sent. No contact has been made. No identity has been asserted
on the project's behalf.**
