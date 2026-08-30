/**
 * Publishers this platform will not acquire from, whatever configuration says.
 *
 * The rights review is the general mechanism, and it works because the answer
 * is genuinely open: a human reads the terms and records what they permit. For
 * a small number of publishers the answer is not open. AHRI's certification
 * directory forbids automated copying and dataset construction; a
 * manufacturer's manuals, images and parts data carry no reuse grant at all.
 * A YAML file declaring one of them GREEN does not make it so — it makes the
 * declaration wrong.
 *
 * So the refusal lives here, in platform code, rather than in the per-source
 * declarations. A denylist stored in `verticals/<slug>/sources/*.yaml` would be
 * defeated by editing the file it lives in, which is exactly the move it exists
 * to prevent. Changing this list is a code change, in a diff, in a pull request
 * — which is the point.
 *
 * **This is a backstop, not a rights engine.** It names publishers already
 * known to be prohibited. A source it does not name is not thereby permitted;
 * it is merely unreviewed, and the rights review still has to happen.
 */

export interface ProhibitedSource {
  /** Registrable domain. The host itself and everything under it are refused. */
  readonly domain: string;
  readonly publisher: string;
  /** Why this is not an open question. */
  readonly reason: string;
  /** What would have to exist before this entry could be removed. */
  readonly liftedBy: string;
}

const WRITTEN_LICENCE =
  'A separate written licence from the publisher, naming this platform, permitting ' +
  'automated acquisition and redistribution of derived data, recorded as a rights ' +
  'review by a named human reviewer.';

const MANUFACTURER_REASON =
  'Manufacturer-published manuals, images, parts data and specification documents are ' +
  'copyrighted works carrying no reuse grant. Availability to a browser is not a licence, ' +
  'and specification values republished from these documents cannot be shown to be ' +
  'lawfully obtained.';

/**
 * Known-prohibited publishers.
 *
 * Domains are the registrable name only, without `www.` — matching covers the
 * host itself and every host under it.
 */
export const PROHIBITED_SOURCES: readonly ProhibitedSource[] = [
  {
    domain: 'ahridirectory.org',
    publisher: 'Air-Conditioning, Heating, and Refrigeration Institute (AHRI)',
    reason:
      'The AHRI Certification Directory is offered for individual look-up. Automated copying, ' +
      'bulk ingestion, redistribution and construction of a derived dataset are outside what ' +
      'the directory is offered for, and no licence covering them has been obtained.',
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'ahrinet.org',
    publisher: 'Air-Conditioning, Heating, and Refrigeration Institute (AHRI)',
    reason:
      'AHRI institutional publications and certification programme content sit under the same ' +
      'terms as the directory, and carry no grant permitting automated reuse.',
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'neep.org',
    publisher: 'Northeast Energy Efficiency Partnerships (NEEP)',
    reason:
      'The Cold Climate Air Source Heat Pump Product List is governed by NEEP terms of use ' +
      'granting a licence to "display, copy, print, and download the Content for personal, ' +
      'non-commercial use only", and stating that NEEP "is the exclusive owner (licensee) of ' +
      'all right, title and interest in the Content on its Site". A commercial data product is ' +
      'the excluded case, named in the terms rather than inferred from silence. The list is ' +
      'also operated in partnership with AHRI, so acquiring it would route around the AHRI ' +
      'entry above rather than avoid it. Assessed 2026-08-23; see ' +
      'docs/sources/hvac-source-landscape-2026-08.md.',
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'carrier.com',
    publisher: 'Carrier Global Corporation',
    reason: MANUFACTURER_REASON,
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'trane.com',
    publisher: 'Trane Technologies',
    reason: MANUFACTURER_REASON,
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'lennox.com',
    publisher: 'Lennox International',
    reason: MANUFACTURER_REASON,
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'lennoxpros.com',
    publisher: 'Lennox International',
    reason:
      `${MANUFACTURER_REASON} This dealer portal additionally sits behind authentication, ` +
      'which no acquisition policy in this platform is permitted to defeat.',
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'york.com',
    publisher: 'York (Johnson Controls)',
    reason: MANUFACTURER_REASON,
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'daikin.com',
    publisher: 'Daikin Industries',
    reason: MANUFACTURER_REASON,
    liftedBy: WRITTEN_LICENCE,
  },
  {
    domain: 'daikincomfort.com',
    publisher: 'Daikin Comfort Technologies',
    reason: MANUFACTURER_REASON,
    liftedBy: WRITTEN_LICENCE,
  },
] as const;

/**
 * Short, distinctive tokens for the prohibited publishers.
 *
 * Separate from `domain` because they answer a different question. A domain
 * identifies a host to refuse; these identify a NAME that must not appear in a
 * file that declares a rights posture — a `publisher`, a `license_text_ref`, a
 * terms URL. The same name appearing as an entity value ("Carrier Infinity
 * 24ANB7") is nominative and entirely fine, which is why the check that uses
 * these is scoped to rights-declaring files rather than run over the tree.
 */
export const PROHIBITED_PUBLISHER_TOKENS: readonly string[] = [
  'Air-Conditioning, Heating, and Refrigeration Institute',
  'Carrier Global',
  'Trane',
  'Lennox',
  'Daikin',
  'Johnson Controls',
] as const;

/**
 * Names that are BOTH a prohibited publisher and a legitimate identifier, and
 * therefore cannot be policed by a token scan at all.
 *
 * `AHRI` is the clearest case. It is the publisher of a prohibited directory —
 * and it is also the certification-reference vocabulary this vertical is built
 * on: `ahri_ref`, the CSV column "AHRI Certified Reference Number", the
 * `AHRI-` prefixes that identifier normalization strips, and
 * `ahri_reference_number`, which is a column of EPA's own public dataset.
 * Scanning for the bare token flags all of those, and deleting them to make a
 * scan quiet would damage identifier normalization while removing no claim.
 *
 * So the boundary is drawn where it can actually be drawn: the DOMAIN is
 * policed mechanically and absolutely, the full legal NAME is policed in
 * rights-declaring files, and the bare token is documented here as out of reach
 * rather than half-policed. What guards it instead is the domain check — a
 * fabricated AHRI rights claim needs a domain to be about.
 */
export const AMBIGUOUS_PUBLISHER_TOKENS: readonly string[] = ['AHRI'] as const;

/**
 * The host a value denotes, or `null` when no host can be determined.
 *
 * Accepts what callers actually have: a bare hostname, `host:port`, a full URL
 * in any scheme, a protocol-relative `//host/path`, with or without
 * credentials, query, fragment, mixed case or a trailing root dot. All of them
 * denote one host, and the policy answer must not depend on which was written.
 *
 * The first version of this normalized only case and a trailing dot. Its single
 * caller passed a bare hostname, so it worked — and
 * `prohibitedSourceFor('https://carrier.com/')` returned `null`. A control that
 * fails open on the most obvious input a future caller would hand it is not a
 * control, and no test caught it because the tests only asked what that one
 * caller asked.
 *
 * Non-hierarchical URIs (`mailto:`, `urn:`) have no authority component and
 * therefore denote no host. They return `null` rather than having a domain
 * guessed out of them.
 */
export function hostnameOf(value: string): string | null {
  const raw = value.trim();
  if (raw === '') return null;
  // Whitespace cannot appear in an authority; refuse rather than let the URL
  // parser percent-encode it into something that parses.
  if (/\s/.test(raw)) return null;

  let candidate: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    candidate = raw; // absolute URL with an authority
  } else if (raw.startsWith('//')) {
    candidate = `http:${raw}`; // protocol-relative
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(raw)) {
    // A scheme with no `//` — mailto:, urn:, data:. No authority, so no host.
    // Excluded first is the `host:port` form, which looks the same to a regex.
    return null;
  } else {
    candidate = `http://${raw}`; // bare host, host:port, host/path
  }

  let hostname: string;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return null;
  }

  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return null;
  // A hostname is labels of letters, digits and hyphens (or a bracketed IPv6
  // literal). Anything else is not a host we are willing to reason about.
  if (!/^\[[0-9a-f:.]+\]$/i.test(host) && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    return null;
  }
  return host;
}

/**
 * The prohibition covering this value, or `null`.
 *
 * Whole labels only. `endsWith('carrier.com')` would also refuse
 * `aircarrier.com`, an unrelated publisher — a control that refuses the wrong
 * party is a control someone will eventually switch off. By the same token
 * `carrier.com.lookalike.example` is a different registrable domain and a
 * different party, and is not refused.
 *
 * **Subdomains are prohibited with their parent.** `parts.carrier.com` is the
 * same publisher as `carrier.com`; a prohibition that stopped at the apex would
 * be lifted by prepending a label.
 *
 * Returns `null` for a value that denotes no host. That is the honest answer to
 * "which prohibition covers this" — the fail-closed decision belongs to
 * {@link decideHost}, which is what the gates call.
 */
export function prohibitedSourceFor(hostOrUrl: string): ProhibitedSource | null {
  const host = hostnameOf(hostOrUrl);
  if (host === null) return null;
  return (
    PROHIBITED_SOURCES.find(
      (entry) => host === entry.domain || host.endsWith(`.${entry.domain}`),
    ) ?? null
  );
}

/**
 * The policy decision for a value, with "could not tell" as its own outcome.
 *
 * Gates must treat `UNDECIDABLE` as blocking. Collapsing it into "not
 * prohibited" is how a malformed domain becomes an allowed one.
 */
export type HostDecision =
  | { readonly kind: 'ALLOWED'; readonly host: string }
  | { readonly kind: 'PROHIBITED'; readonly host: string; readonly prohibition: ProhibitedSource }
  | { readonly kind: 'UNDECIDABLE'; readonly reason: string };

export function decideHost(value: string): HostDecision {
  const host = hostnameOf(value);
  if (host === null) {
    return {
      kind: 'UNDECIDABLE',
      reason:
        `"${value}" does not denote a host that can be checked against the prohibited-source ` +
        `list. Refusing rather than assuming it is permitted.`,
    };
  }
  const prohibition = prohibitedSourceFor(host);
  return prohibition === null
    ? { kind: 'ALLOWED', host }
    : { kind: 'PROHIBITED', host, prohibition };
}
