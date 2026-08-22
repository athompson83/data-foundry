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

/** One spelling per host: case-insensitive, and the trailing dot is the root label. */
const normalizeHost = (host: string): string => host.trim().toLowerCase().replace(/\.$/, '');

/**
 * The prohibition covering this host, or `null`.
 *
 * Whole labels only. `endsWith('carrier.com')` would also refuse
 * `aircarrier.com`, an unrelated publisher — a control that refuses the wrong
 * party is a control someone will eventually switch off.
 */
export function prohibitedSourceFor(domain: string): ProhibitedSource | null {
  const host = normalizeHost(domain);
  if (host === '') return null;
  return (
    PROHIBITED_SOURCES.find(
      (entry) => host === entry.domain || host.endsWith(`.${entry.domain}`),
    ) ?? null
  );
}
