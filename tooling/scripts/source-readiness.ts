/**
 * Phase 2 real-source readiness report.
 *
 * The HVAC vertical proves the factory runs. It does not prove the factory
 * works on data anyone actually publishes, because every one of its sources is
 * synthetic — fictional publishers on RFC 2606 reserved domains, authored by us.
 * A rights gate that passes on our own fixtures tells us the gate executes; it
 * says nothing about whether a real publisher's terms permit what we intend.
 *
 * That distinction is easy to lose. A green `verticals:validate` and a green
 * test suite both report success, and neither is a statement about real data.
 * This report exists so the difference is visible on demand rather than
 * remembered, and so "are we ready to publish commercially?" has a mechanical
 * answer instead of an optimistic one.
 *
 * It reads the same declarations the platform reads. It reaches no network and
 * asserts nothing about any real organisation — a source is classified real or
 * synthetic by its domain, not by its name.
 *
 *   pnpm sources:readiness            # every vertical
 *   pnpm sources:readiness hvac       # one vertical
 *   pnpm sources:readiness --json     # machine-readable
 *
 * Exit code is 0 whether or not a vertical is ready: this reports a state, it
 * does not gate CI. `verticals:validate` is the gate.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { VERTICALS_DIR } from '../validators/validate-verticals.js';

/**
 * Domains reserved by RFC 2606 and RFC 6761 for documentation and testing. A
 * source on one of these cannot be a real publisher: the names are reserved
 * precisely so that they never resolve to anyone.
 */
const RESERVED_SUFFIXES = [
  '.example.com',
  '.example.org',
  '.example.net',
  '.example',
  '.test',
  '.invalid',
  '.localhost',
] as const;

const RESERVED_EXACT = ['example.com', 'example.org', 'example.net', 'localhost'] as const;

/** Whether a domain is reserved, and therefore cannot name a real publisher. */
export function isReservedDomain(domain: string): boolean {
  // `example.com.` is the same name as `example.com` — the trailing dot is the
  // root label written out. Without stripping it, a fully qualified reserved
  // name is counted as a real publisher, which is the one direction this
  // function must never get wrong.
  const host = domain.trim().toLowerCase().replace(/\.$/, '');
  if (host === '') return false;
  if (RESERVED_EXACT.includes(host as (typeof RESERVED_EXACT)[number])) return true;
  return RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** What a single source declaration says about its own rights posture. */
export interface SourceReadiness {
  readonly key: string;
  readonly domain: string;
  /** False when the domain is reserved — a synthetic fixture, not a publisher. */
  readonly real: boolean;
  readonly rightsClassification: string;
  readonly status: string;
  /** Every commercial permission the declaration grants, or withholds. */
  readonly commercialUseAllowed: boolean;
  readonly redistributionAllowed: boolean;
  readonly derivativeNormalizationAllowed: boolean;
  readonly imagesReusable: boolean;
  readonly attributionRequired: boolean;
  /** The text that will be displayed. A required attribution with none is unmeetable. */
  readonly attributionText: string | null;
  readonly personalDataPresent: boolean;
  readonly reviewedAt: string | null;
  readonly nextReviewAt: string | null;
  readonly acquisitionApproved: boolean;
  readonly retainsArtifacts: boolean;
  readonly killSwitchEngaged: boolean;
  /** Whether `image_policy` exists to govern the images the rights block permits. */
  readonly imagePolicyDeclared: boolean;
}

/** The conditions `DATA_RIGHTS.md` requires before a dataset is sold. */
export interface CommercialGate {
  readonly noUnreviewedSources: boolean;
  readonly everyPublishingSourcePermitsCommercialUse: boolean;
  readonly everyPublishingSourcePermitsRedistribution: boolean;
  readonly everyPublishingSourcePermitsDerivativeNormalization: boolean;
  readonly attributionObligationsRecorded: boolean;
  readonly imageRightsSettledSeparately: boolean;
}

export interface VerticalReadiness {
  readonly slug: string;
  readonly status: string;
  readonly sources: readonly SourceReadiness[];
  readonly realSourceCount: number;
  readonly syntheticSourceCount: number;
  /** Distinct publishers among REAL sources — the independence signal. */
  readonly realPublisherCount: number;
  readonly commercialGate: CommercialGate;
  /** True only when at least one real source has passed a full rights review. */
  readonly hasRealRightsReviewedSource: boolean;
  readonly blockers: readonly string[];
}

const bool = (value: unknown): boolean => value === true;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

function readSource(raw: Record<string, unknown>): SourceReadiness {
  const rights = (raw['rights_policy'] ?? {}) as Record<string, unknown>;
  const attribution = (rights['attribution'] ?? {}) as Record<string, unknown>;
  const acquisition = (raw['acquisition_policy'] ?? {}) as Record<string, unknown>;
  const retention = (raw['provenance_retention'] ?? {}) as Record<string, unknown>;
  const domain = text(raw['domain']);

  return {
    key: text(raw['key']),
    domain,
    real: !isReservedDomain(domain),
    rightsClassification: text(raw['rights_classification']) || 'UNREVIEWED',
    status: text(raw['status']),
    commercialUseAllowed: bool(rights['commercial_use_allowed']),
    redistributionAllowed: bool(rights['redistribution_allowed']),
    derivativeNormalizationAllowed: bool(rights['derivative_normalization_allowed']),
    imagesReusable: bool(rights['images_reusable']),
    attributionRequired: bool(attribution['required']),
    attributionText: nullableText(attribution['text']),
    personalDataPresent: bool(rights['personal_data_present']),
    reviewedAt: nullableText(rights['reviewed_at']),
    nextReviewAt: nullableText(rights['next_review_at']),
    acquisitionApproved: bool(acquisition['approved']),
    retainsArtifacts: bool(retention['retain_artifacts']),
    killSwitchEngaged: bool(raw['kill_switch_engaged']),
    imagePolicyDeclared:
      typeof raw['image_policy'] === 'object' && raw['image_policy'] !== null,
  };
}

/** Sources whose data may actually reach a published surface. */
const publishing = (sources: readonly SourceReadiness[]): SourceReadiness[] =>
  sources.filter(
    (source) =>
      source.status === 'ACTIVE' &&
      !source.killSwitchEngaged &&
      (source.rightsClassification === 'GREEN' || source.rightsClassification === 'AMBER'),
  );

export function assess(slug: string, status: string, raws: readonly Record<string, unknown>[]) {
  const sources = raws.map(readSource);
  const real = sources.filter((source) => source.real);
  const live = publishing(sources);
  // Everything switched on, whatever its classification. `publishing()` already
  // drops UNREVIEWED, so asking THAT set whether anything is unreviewed can
  // never answer no — the question has to be put to the set that can still
  // contain one.
  const enabled = sources.filter((source) => source.status === 'ACTIVE' && !source.killSwitchEngaged);

  const commercialGate: CommercialGate = {
    noUnreviewedSources: enabled.every((source) => source.rightsClassification !== 'UNREVIEWED'),
    everyPublishingSourcePermitsCommercialUse: live.every((source) => source.commercialUseAllowed),
    everyPublishingSourcePermitsRedistribution: live.every((source) => source.redistributionAllowed),
    // Condition 2 of DATA_RIGHTS.md asks whether the terms permit "the use being
    // made, including the derivative and redistribution question". Normalizing
    // and deriving IS the use being made — a source that forbids it can be read
    // and cited but not processed, so it cannot be left to a rendered field
    // nobody gates on.
    everyPublishingSourcePermitsDerivativeNormalization: live.every(
      (source) => source.derivativeNormalizationAllowed,
    ),
    // An obligation can only be honoured if it was written down: a source that
    // requires attribution must carry the text a surface will actually display.
    attributionObligationsRecorded: live.every(
      (source) => !source.attributionRequired || source.attributionText !== null,
    ),
    // Rule 9: the right to state a specification is not the right to republish a
    // photograph. A source that claims reusable images must also carry an
    // image_policy that says what may be done with them, so the two cannot
    // disagree silently.
    imageRightsSettledSeparately: live.every(
      (source) => !source.imagesReusable || source.imagePolicyDeclared,
    ),
  };

  const hasRealRightsReviewedSource = real.some(
    (source) =>
      source.reviewedAt !== null &&
      source.rightsClassification !== 'UNREVIEWED' &&
      source.acquisitionApproved,
  );

  const blockers: string[] = [];
  if (real.length === 0) {
    blockers.push(
      'every source is synthetic: the rights machinery has been exercised, but never against ' +
        'terms written by someone else',
    );
  }
  if (!hasRealRightsReviewedSource) {
    blockers.push('no real source has completed a rights review with an approved acquisition method');
  }
  for (const source of live) {
    if (!source.retainsArtifacts) {
      blockers.push(`${source.key} publishes without retaining its raw artifacts (rule 10)`);
    }
    if (source.personalDataPresent) {
      blockers.push(`${source.key} declares personal data present — needs a handling decision`);
    }
  }
  if (status !== 'DRAFT' && blockers.length > 0) {
    blockers.push(`vertical.yaml says status: ${status} while the conditions above are unmet`);
  }

  return {
    slug,
    status,
    sources,
    realSourceCount: real.length,
    syntheticSourceCount: sources.length - real.length,
    realPublisherCount: new Set(real.map((source) => source.domain)).size,
    commercialGate,
    hasRealRightsReviewedSource,
    blockers,
  } satisfies VerticalReadiness;
}

export async function readVertical(dir: string, slug: string): Promise<VerticalReadiness> {
  const config = parseYaml(await readFile(join(dir, 'vertical.yaml'), 'utf8')) as Record<
    string,
    unknown
  >;
  const sourcesDir = join(dir, 'sources');
  const files = (await readdir(sourcesDir)).filter(
    (file) => file.endsWith('.yaml') || file.endsWith('.yml'),
  );
  const raws: Record<string, unknown>[] = [];
  for (const file of files.sort()) {
    raws.push(parseYaml(await readFile(join(sourcesDir, file), 'utf8')) as Record<string, unknown>);
  }
  return assess(slug, text(config['status']) || 'UNKNOWN', raws);
}

function render(report: VerticalReadiness): string {
  const lines: string[] = [];
  const verdict = report.blockers.length === 0 ? 'READY' : 'NOT READY';
  lines.push(`${report.slug} — ${verdict} for real-source validation (status: ${report.status})`);
  lines.push(
    `  sources: ${report.realSourceCount} real / ${report.syntheticSourceCount} synthetic` +
      `, ${report.realPublisherCount} real publisher(s)`,
  );

  for (const source of report.sources) {
    const kind = source.real ? 'real' : 'SYNTHETIC';
    const permissions = [
      source.commercialUseAllowed ? 'commercial' : 'no-commercial',
      source.redistributionAllowed ? 'redistribute' : 'no-redistribute',
      source.derivativeNormalizationAllowed ? 'derive' : 'no-derive',
      source.imagesReusable ? 'images' : 'no-images',
    ].join(' · ');
    lines.push(
      `    ${source.key} [${kind}] ${source.rightsClassification}/${source.status}` +
        ` — ${permissions}` +
        (source.reviewedAt === null ? ' — NEVER REVIEWED' : ` — reviewed ${source.reviewedAt}`),
    );
  }

  lines.push('  commercial publication gate:');
  for (const [name, passed] of Object.entries(report.commercialGate)) {
    lines.push(`    ${passed ? 'pass' : 'FAIL'}  ${name}`);
  }

  if (report.blockers.length > 0) {
    lines.push('  blocking real-source validation:');
    for (const blocker of report.blockers) lines.push(`    - ${blocker}`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const wanted = args.filter((arg) => !arg.startsWith('--'));

  const entries = await readdir(VERTICALS_DIR, { withFileTypes: true });
  const slugs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .filter((slug) => wanted.length === 0 || wanted.includes(slug))
    .sort();

  const reports: VerticalReadiness[] = [];
  for (const slug of slugs) reports.push(await readVertical(join(VERTICALS_DIR, slug), slug));

  if (asJson) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    return;
  }

  if (reports.length === 0) {
    process.stdout.write('No verticals to report on.\n');
    return;
  }
  process.stdout.write(`${reports.map(render).join('\n\n')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
