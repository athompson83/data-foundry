/**
 * The dataset expansion pipeline (docs/sources/pipeline/) is advanced by a
 * scheduled agent session every week. Nothing reads candidates.yaml at runtime,
 * so this test is the only thing that stops a run from recording a malformed
 * candidate, an invented stage, or a claim with no evidence behind it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REGISTRY = `${ROOT}docs/sources/pipeline/candidates.yaml`;

const STAGES = ['DISCOVERED', 'SCREENED', 'EVIDENCED', 'RIGHTS_DETERMINED', 'PROTOTYPED', 'BUILDING', 'LIVE', 'PARKED'] as const;
const score = z.number().int().min(1).max(5);

const Candidate = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(3),
    category: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
    structuring: z.enum(['identifier-extraction', 'eligibility-criteria', 'obligation-timeline', 'event-extraction', 'normalization']),
    stage: z.enum(STAGES),
    rights: z.enum(['GREEN', 'AMBER', 'RED', 'UNKNOWN']),
    sources: z.array(z.string().url()).min(1),
    scores: z
      .object({
        agent_demand: score,
        rights_clarity: score,
        acquisition_ease: score,
        structuring_value: score,
        freshness: score,
        low_onboarding_cost: score,
        poor_existing_access: score,
      })
      .strict(),
    evidence: z.array(z.string()).default([]),
    conditions: z.array(z.string().min(3)).optional(),
    terms: z.array(z.object({ url: z.string().url().startsWith('https://'), quote: z.string().min(40) }).strict()).optional(),
    next_action: z.string().min(10),
  })
  .strict();

/**
 * A dataset is one entity type assembled from several candidate sources, linked
 * by deterministic join keys whose match rates were measured on real samples
 * (Product Owner direction, 2026-09-27: datasets are aggregates of several
 * sources). Single candidates are feeds; the dataset is what is built and sold.
 */
const Dataset = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(3),
    category: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
    entity: z.string().min(3),
    stage: z.enum(STAGES),
    description: z.string().min(20),
    sources: z.array(z.string()).min(2),
    // `declared`: an identifier that names the counterpart record (licence number, check-digit-valid GTIN,
    // cited approval or case number) — may link automatically, at the level it names. `candidate`: names,
    // brands, model tokens, titles, markers that only say a counterpart exists (e.g. Health Canada's
    // joint-recall marker) and shared attributes — proposes a link for review only (AGENTS.md rules 3 and 7).
    // `reviewed`: a hand-check of candidate matches — how many of the checked matches were the same record.
    join_keys: z
      .array(
        z
          .object({
            key: z.string().min(3),
            between: z.tuple([z.string(), z.string()]),
            measured: z.string().min(1),
            mode: z.enum(['declared', 'candidate']),
            reviewed: z.object({ correct: z.number().int().nonnegative(), checked: z.number().int().positive() }).strict().refine((r) => r.correct <= r.checked, 'correct <= checked').optional(),
          })
          .strict(),
      )
      .min(1),
    taxonomy: z.array(z.string().min(3)).min(1),
    agent_questions: z.array(z.string().min(10)).min(1),
    scores: Candidate.shape.scores,
    evidence: z.array(z.string()).min(1),
    next_action: z.string().min(10),
  })
  .strict();

const Registry = z
  .object({ version: z.literal(1), updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), candidates: z.array(Candidate).min(1), datasets: z.array(Dataset).min(1) })
  .strict();

const registry = Registry.parse(parseYaml(readFileSync(REGISTRY, 'utf8')));
const beyond = (stage: (typeof STAGES)[number], floor: (typeof STAGES)[number]) =>
  stage !== 'PARKED' && STAGES.indexOf(stage) >= STAGES.indexOf(floor);

describe('dataset expansion pipeline registry', () => {
  it('documents the scheduler that performs the weekly run', () => {
    const routine = readFileSync(`${ROOT}docs/sources/pipeline/scout-routine.md`, 'utf8');
    expect(routine).toMatch(/Trigger ID \| `trig_[A-Za-z0-9]+`/);
    expect(routine).toMatch(/Schedule \| `[0-9*\/ ,-]+`/);
    expect(routine).toContain('npx vitest run tooling/test/source-pipeline.test.ts');
    expect(readFileSync(`${ROOT}docs/sources/pipeline/README.md`, 'utf8')).toContain('scout-routine.md');
  });

  it('has unique keys', () => {
    const keys = registry.candidates.map((candidate) => candidate.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(registry.candidates)('$key cites evidence that exists once it is past DISCOVERED', (candidate) => {
    if (candidate.stage === 'DISCOVERED') return;
    expect(candidate.evidence.length, 'a screened candidate needs an evidence record').toBeGreaterThan(0);
    for (const path of candidate.evidence) expect(existsSync(`${ROOT}${path}`), `${path} must exist`).toBe(true);
  });

  const SampleEntry = z
    .object({
      population: z.string().min(10),
      sample: z.string().min(10),
      sample_size: z.number().int().min(20),
      scripts: z.array(z.string()).min(1),
      results: z.array(z.string()).min(1),
      identifiers: z.record(z.string(), z.array(z.unknown()).min(1)),
    })
    .strict();
  const between = (stage: (typeof STAGES)[number]) => beyond(stage, 'EVIDENCED') && stage !== 'LIVE';
  const rounds = (evidence: string[]) =>
    evidence
      .map((path) => /^docs\/sources\/pipeline\/research-(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1])
      .filter((round): round is string => Boolean(round));
  const normalise = (text: string) => text.replace(/\s+/g, ' ');

  it.each(registry.candidates)('$key commits its own sample evidence while between EVIDENCED and BUILDING', (candidate) => {
    // LIVE datasets are evidenced by their rights record and reconciliation; PARKED ones are stopped.
    if (!between(candidate.stage)) return;
    const cited = rounds(candidate.evidence);
    expect(cited.length, `${candidate.key} must cite a docs/sources/pipeline/research-*.md round`).toBeGreaterThan(0);
    for (const round of cited) {
      const dir = `${ROOT}docs/sources/pipeline/evidence/${round}`;
      const samples = JSON.parse(readFileSync(`${dir}/samples.json`, 'utf8')) as Record<string, unknown>;
      const entry = SampleEntry.parse(samples[candidate.key]);
      for (const path of [...entry.scripts, ...entry.results]) expect(existsSync(`${dir}/${path}`), `evidence/${round}/${path} must exist`).toBe(true);
      const identified = Object.values(entry.identifiers).reduce((total, list) => total + list.length, 0);
      expect(identified, 'the identifiers cover the declared sample size').toBeGreaterThanOrEqual(entry.sample_size);
    }
  });

  const Inputs = z
    .object({
      archive: z.object({ bucket: z.string().min(1), key: z.string().min(1), bytes: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
      note: z.string().min(10),
      replay: z.array(z.tuple([z.string(), z.string()])).min(1),
      acquisition_only: z.array(z.string()).default([]),
      files: z.array(z.object({ path: z.string().min(1), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).min(1),
    })
    .strict();

  it.each(registry.candidates)('$key can be replayed from preserved inputs', (candidate) => {
    if (!between(candidate.stage)) return;
    for (const round of rounds(candidate.evidence)) {
      const dir = `${ROOT}docs/sources/pipeline/evidence/${round}`;
      expect(existsSync(`${dir}/replay.sh`), `evidence/${round}/replay.sh must exist`).toBe(true);
      const inputs = Inputs.parse(JSON.parse(readFileSync(`${dir}/inputs.json`, 'utf8')));
      const preserved = new Set(inputs.files.map((file) => file.path));
      const replayed = new Map(inputs.replay.map(([script, result]) => [result, script]));
      const samples = JSON.parse(readFileSync(`${dir}/samples.json`, 'utf8')) as Record<string, { results: string[]; scripts: string[] }>;
      const entry = samples[candidate.key]!;
      for (const result of entry.results) {
        const script = replayed.get(result);
        expect(script, `${result} must be produced by a replayed script`).toBeDefined();
        // Every input the script reads must be in the preserved archive.
        const source = readFileSync(`${dir}/${script}`, 'utf8');
        const reads = [...source.matchAll(/open\(\s*['"]([^'"{}]+)['"]/g)].map((match) => match[1]!);
        for (const file of reads) {
          if (/'w'|"w"/.test(source.slice(source.indexOf(file), source.indexOf(file) + file.length + 8))) continue;
          expect(preserved.has(file), `${script} reads ${file}, which must be in inputs.json`).toBe(true);
        }
        for (const glob of source.matchAll(/glob\(f?['"](?:\{R\}\/)?([^'"*]+)\*/g)) {
          expect([...preserved].some((path) => path.startsWith(glob[1]!)), `${script} globs ${glob[1]}*, which must be in inputs.json`).toBe(true);
        }
      }
      for (const script of entry.scripts) {
        expect([...replayed.values()].includes(script) || inputs.acquisition_only.includes(script), `${script} must be replayed or marked acquisition_only`).toBe(true);
      }
    }
  });

  it.each(registry.candidates)('$key quotes its terms verbatim, with URLs, once EVIDENCED', (candidate) => {
    if (!between(candidate.stage)) return;
    expect(candidate.terms?.length ?? 0, `${candidate.key} needs at least one terms {url, quote}`).toBeGreaterThan(0);
    const research = rounds(candidate.evidence).map((round) => normalise(readFileSync(`${ROOT}docs/sources/pipeline/research-${round}.md`, 'utf8')));
    for (const term of candidate.terms ?? []) {
      expect(research.some((text) => text.includes(normalise(term.quote))), `quote must appear verbatim in the research record: ${term.quote}`).toBe(true);
      expect(research.some((text) => text.includes(term.url)), `terms URL must be cited in the research record: ${term.url}`).toBe(true);
    }
  });

  it.each(registry.candidates)('$key never advances past EVIDENCED on RED or UNKNOWN rights', (candidate) => {
    if (beyond(candidate.stage, 'RIGHTS_DETERMINED')) expect(['GREEN', 'AMBER']).toContain(candidate.rights);
  });

  it.each(registry.candidates)('$key lists the conditions it must satisfy when rights are AMBER', (candidate) => {
    if (candidate.rights === 'AMBER' && candidate.stage !== 'PARKED') expect(candidate.conditions?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(registry.candidates)('$key has a rights record once rights are determined', (candidate) => {
    if (!beyond(candidate.stage, 'RIGHTS_DETERMINED')) return;
    expect(candidate.evidence.some((path) => /^docs\/sources\/[a-z0-9-]+-rights-record-\d{8}\.md$/.test(path)), 'cite docs/sources/<source>-rights-record-YYYYMMDD.md').toBe(true);
  });

  const byKey = new Map(registry.candidates.map((candidate) => [candidate.key, candidate]));
  /** A join endpoint may name a sub-table of a member, e.g. "x-licences (bond table)". */
  const member = (endpoint: string) => endpoint.replace(/\s*\(.*\)$/, '');
  /**
   * The registrable domain (publisher) of a source URL, so alternate subdomains of one publisher
   * (data.x.gov, api.x.gov) count as one source. Two-label public suffixes used in the registry are
   * listed explicitly; anything else keeps its last two labels.
   */
  const MULTI_LABEL_SUFFIXES = new Set(['gov.uk', 'co.uk', 'org.uk', 'gov.au', 'com.au', 'govt.nz', 'co.nz']);
  const hostOf = (url: string) => {
    const labels = new URL(url).hostname.toLowerCase().split('.');
    const keep = MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
    return labels.slice(-keep).join('.');
  };

  it('has unique dataset keys, distinct from candidate keys', () => {
    const keys = registry.datasets.map((dataset) => dataset.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(byKey.has(key), `${key} is also a candidate key`).toBe(false);
  });

  it.each(registry.datasets)('$key aggregates at least two independent, lawful sources', (dataset) => {
    for (const key of dataset.sources) expect(byKey.has(key), `${key} is not a candidate`).toBe(true);
    expect(new Set(dataset.sources).size, 'members are listed once').toBe(dataset.sources.length);
    const members = dataset.sources.map((key) => byKey.get(key)!);
    // Independence is between members, not across the union of URLs: some pair of distinct members must share
    // no host, so one feed republished under a second key cannot pass as a composite.
    const hostSets = members.map((candidate) => new Set(candidate.sources.map(hostOf)));
    const independent = hostSets.some((a, i) => hostSets.some((b, j) => j > i && [...a].every((host) => !b.has(host))));
    expect(independent, 'at least two members share no source host').toBe(true);
    for (const candidate of members) expect(candidate.rights, `${candidate.key} is RED; a dataset may not use it`).not.toBe('RED');
    if (beyond(dataset.stage, 'EVIDENCED')) for (const candidate of members) expect(['GREEN', 'AMBER'], `${candidate.key} rights`).toContain(candidate.rights);
    // A dataset cannot run ahead of its feeds. From RIGHTS_DETERMINED on (a rights label is provisional until
    // the ADR-0013 determination is recorded), every member must have reached the dataset's own stage, so a
    // BUILDING dataset has built feeds and a LIVE dataset has only LIVE, runtime-verified feeds.
    if (beyond(dataset.stage, 'RIGHTS_DETERMINED'))
      for (const candidate of members) expect(beyond(candidate.stage, dataset.stage), `${candidate.key} is ${candidate.stage}; a ${dataset.stage} dataset needs every member at ${dataset.stage} or later`).toBe(true);
    for (const path of dataset.evidence) expect(existsSync(`${ROOT}${path}`), `${path} must exist`).toBe(true);
  });

  it.each(registry.datasets)('$key links its members on measured join keys', (dataset) => {
    for (const join of dataset.join_keys) for (const end of join.between) expect(dataset.sources, `${join.key}: ${end} must be a member`).toContain(member(end));
    const measured = dataset.join_keys.filter((join) => {
      const [a, b] = join.between.map(member);
      const ratio = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/.exec(join.measured);
      const hostsA = new Set(byKey.get(a!)!.sources.map(hostOf));
      const independent = byKey.get(b!)!.sources.every((url) => !hostsA.has(hostOf(url)));
      if (ratio === null) return false;
      const [matched, total] = [Number(ratio[1]!.replaceAll(',', '')), Number(ratio[2]!.replaceAll(',', ''))];
      // 0/0 records no sample, and 0/N records no link: zero-match rows stay in the registry as evidence, but only
      // a join with at least one match shows that the members actually link. A declared match is a link by
      // definition; a candidate match counts only once a hand-check confirmed at least one of them (the rest
      // still go to review before publication).
      const linked = join.mode === 'declared' || (join.reviewed !== undefined && join.reviewed.correct > 0);
      return a !== b && independent && total > 0 && matched > 0 && matched <= total && linked;
    });
    expect(measured.length, 'at least one join with a confirmed link (declared, or a candidate with reviewed.correct > 0) between members that share no host').toBeGreaterThan(0);
  });

  it.each(registry.datasets)('$key never auto-links on names, brands, model tokens or titles', (dataset) => {
    for (const join of dataset.join_keys) {
      // Substring match on purpose: `brand_key`, `model_key` and "exact label" are all names, and `_`
      // would defeat a \b word boundary.
      if (/name|brand|model|title|token|phone|prefix|marker|label|pattern|filer/i.test(join.key)) expect(join.mode, `${join.key} must be a review candidate`).toBe('candidate');
      // And a declared join must name an identifier that points at the counterpart record.
      if (join.mode === 'declared') expect(join.key, `${join.key} is declared but names no identifier`).toMatch(/licen[cs]e number|\bUBI\b|GTIN|UPC|NOA|FL#|FIPS|zone|code version|case number|HVHZ flag/i);
    }
  });

  /** Feeds that were LIVE before 2026-09-27, when datasets became composites. Never add to this set. */
  const GRANDFATHERED_LIVE = new Set(['fda-recalls']);

  it('grandfathers only feeds that are still LIVE', () => {
    for (const key of GRANDFATHERED_LIVE) expect(byKey.get(key)?.stage, `${key} is grandfathered`).toBe('LIVE');
  });

  it.each(registry.candidates)('$key belongs to a dataset once it is being built', (candidate) => {
    // Only feeds that went LIVE before the composite rule keep standalone status, until a dataset adopts them.
    if (candidate.stage === 'LIVE' && GRANDFATHERED_LIVE.has(candidate.key)) return;
    if (!beyond(candidate.stage, 'PROTOTYPED')) return;
    expect(registry.datasets.some((dataset) => dataset.sources.includes(candidate.key)), `${candidate.key} must be a member of a dataset`).toBe(true);
  });

  const Count = z.object({ hits: z.number().int().nonnegative(), of: z.number().int().positive() }).strict();
  const Coverage = z
    .object({
      key: z.string(),
      parser_version: z.string().regex(/^[a-z0-9-]+@\d+$/),
      package: z.string().regex(/^packages\/[a-z0-9-]+$/),
      golden_tests: z.array(z.string().regex(/^packages\/[a-z0-9-]+\/test\/.+\.test\.ts$/)).min(1),
      runner: z.string().regex(/^tooling\/prototypes\/[a-z0-9-]+\.ts$/),
      command: z.string().min(10),
      snapshot: z
        .object({
          source: z.string().url(),
          retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          records: z.number().int().positive(),
          archives: z.array(z.object({ bucket: z.string().min(1), key: z.string().min(1), bytes: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).min(1),
        })
        .strict(),
      errors: z.literal(0),
      fields: z.record(z.string(), Count).refine((fields) => Object.keys(fields).length > 0),
      precision: z.record(z.string(), z.object({ correct: z.number().int().nonnegative(), checked: z.number().int().positive(), method: z.string().min(20) }).strict()).optional(),
    })
    .strict();

  it.each(registry.candidates)('$key runs a deterministic prototype over the full snapshot once PROTOTYPED', (candidate) => {
    if (!between(candidate.stage) || !beyond(candidate.stage, 'PROTOTYPED')) return;
    const report = `docs/sources/pipeline/prototypes/${candidate.key}/README.md`;
    expect(candidate.evidence, `cite ${report}`).toContain(report);
    const dir = `${ROOT}docs/sources/pipeline/prototypes/${candidate.key}`;
    const coverage = Coverage.parse(JSON.parse(readFileSync(`${dir}/coverage.json`, 'utf8')));
    expect(coverage.key).toBe(candidate.key);
    expect(existsSync(`${ROOT}${coverage.package}/src/index.ts`), `${coverage.package} must exist`).toBe(true);
    for (const test of coverage.golden_tests) expect(existsSync(`${ROOT}${test}`), `${test} must exist`).toBe(true);
    expect(existsSync(`${ROOT}${coverage.runner}`), `${coverage.runner} must exist`).toBe(true);
    for (const [field, count] of Object.entries(coverage.fields)) expect(count.hits, `${field} hits cannot exceed its denominator`).toBeLessThanOrEqual(count.of);
    for (const [field, check] of Object.entries(coverage.precision ?? {})) expect(check.correct, `${field} precision`).toBeLessThanOrEqual(check.checked);
  });
});
