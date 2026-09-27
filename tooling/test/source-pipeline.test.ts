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
    next_action: z.string().min(10),
  })
  .strict();

const Registry = z.object({ version: z.literal(1), updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), candidates: z.array(Candidate).min(1) }).strict();

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

  it.each(registry.candidates)('$key commits its sample evidence while between EVIDENCED and BUILDING', (candidate) => {
    // LIVE datasets are evidenced by their rights record and reconciliation; PARKED ones are stopped.
    if (!beyond(candidate.stage, 'EVIDENCED') || candidate.stage === 'LIVE') return;
    const rounds = candidate.evidence
      .map((path) => /^docs\/sources\/pipeline\/research-(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1])
      .filter((round): round is string => Boolean(round));
    expect(rounds.length, `${candidate.key} must cite a docs/sources/pipeline/research-*.md round`).toBeGreaterThan(0);
    for (const round of rounds) {
      const dir = `${ROOT}docs/sources/pipeline/evidence/${round}`;
      for (const sub of ['scripts', 'results']) {
        expect(existsSync(`${dir}/${sub}`) && readdirSync(`${dir}/${sub}`).length > 0, `evidence/${round}/${sub} must not be empty`).toBe(true);
      }
      const samples = JSON.parse(readFileSync(`${dir}/samples.json`, 'utf8')) as Record<string, Record<string, unknown>>;
      const entry = samples[candidate.key];
      expect(entry, `evidence/${round}/samples.json lists ${candidate.key}`).toBeDefined();
      expect(typeof entry?.['population'] === 'string' && typeof entry?.['sample'] === 'string', 'population and sample are described').toBe(true);
      const identifiers = Object.values(entry ?? {}).filter((value): value is unknown[] => Array.isArray(value));
      expect(identifiers.length > 0 && identifiers.every((list) => list.length > 0), 'every identifier list is non-empty').toBe(true);
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
    expect(candidate.evidence.some((path) => /rights-record/.test(path)), 'cite docs/sources/*rights-record*').toBe(true);
  });
});
