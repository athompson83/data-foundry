/**
 * Compile the local collector's source policy (apps/local-collector/policy/sources.json)
 * from the authoritative registry, so the collector never carries its own idea
 * of what is permitted:
 *
 * - rights verdict and stage from docs/sources/pipeline/candidates.yaml;
 * - the ADR-0013 rights record, which must exist on disk;
 * - the prohibited-domain list from packages/source-registry (platform code).
 *
 * A task is enabled only for a GREEN source, or an AMBER source with a rights
 * record, at PROTOTYPED or later, whose hosts are not prohibited. Anything else
 * compiles to enabled: false with the reason, and the collector refuses it.
 * The collector (and its model) cannot edit this file's inputs: changing them
 * is a reviewed pull request.
 *
 *   tsx tooling/scripts/local-collector-policy.ts          # write
 *   tsx tooling/scripts/local-collector-policy.ts --check  # fail if stale
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import { PROHIBITED_SOURCES, prohibitedSourceFor } from '../../packages/source-registry/src/prohibited-sources.js';

const ROOT = join(import.meta.dirname, '..', '..');
const REGISTRY = 'docs/sources/pipeline/candidates.yaml';
const OUT = 'apps/local-collector/policy/sources.json';

/** Collector tasks. Adding one is a reviewed code change; its permission still comes from the registry. */
const COLLECTOR_TASKS = [
  {
    task: 'cpsc-product-identifiers@1',
    source: 'cpsc-recalls',
    rights_record: 'docs/sources/cpsc-recalls-rights-record-20260927.md',
    // Input is Data Foundry's own stored evidence: the recalls Worker is the single scheduling owner of CPSC
    // acquisition, so the collector never re-fetches the CPSC feed or races its six-hourly sync.
    input: { kind: 'dataforge-api', path: '/v1/product-recalls', params: { agency: 'CPSC' } },
    allowed_hosts: ['api.data.aroqon.com'],
    intake_path: '/v1/intake/product-recalls/identifiers',
    min_interval_s: 2,
  },
] as const;

const PERMITTED_STAGES = new Set(['PROTOTYPED', 'BUILDING', 'LIVE']);

interface Candidate {
  key: string;
  name?: string;
  stage: string;
  rights: string;
  format?: string;
  publisher?: string;
  sources?: string[];
  evidence?: string[];
}

interface RegistryDataset {
  key: string;
  name?: string;
  stage: string;
  sources: string[];
}

/** Why a source may not be acquired by the collector, or [] when its rights and stage permit it. */
function acquisitionBlockers(entry: Candidate): string[] {
  const reasons: string[] = [];
  if (entry.rights !== 'GREEN' && entry.rights !== 'AMBER') reasons.push(`rights verdict is ${entry.rights ?? 'unrecorded'}`);
  else if (!(entry.evidence ?? []).some((path) => /rights-record-\d{8}\.md$/.test(path) && existsSync(join(ROOT, path)))) reasons.push('no ADR-0013 rights record in the registry evidence');
  if (!PERMITTED_STAGES.has(entry.stage)) reasons.push(`stage ${entry.stage} is before PROTOTYPED`);
  for (const url of entry.sources ?? []) if (prohibitedSourceFor(url)) reasons.push(`source host ${url} is prohibited`);
  return reasons;
}

export function compilePolicy(): string {
  const registryText = readFileSync(join(ROOT, REGISTRY), 'utf8');
  const registry = parse(registryText) as { candidates: Candidate[]; datasets?: RegistryDataset[] };
  const tasks = COLLECTOR_TASKS.map((task) => {
    const entry = registry.candidates.find((candidate) => candidate.key === task.source);
    const reasons: string[] = [];
    if (!entry) reasons.push(`${task.source} is not in the registry`);
    else {
      if (entry.rights !== 'GREEN' && entry.rights !== 'AMBER') reasons.push(`rights verdict is ${entry.rights}`);
      if (!PERMITTED_STAGES.has(entry.stage)) reasons.push(`stage ${entry.stage} is before PROTOTYPED`);
      if (entry.rights === 'AMBER' && !(entry.evidence ?? []).includes(task.rights_record)) reasons.push('AMBER source without its rights record in the registry evidence');
      for (const url of entry.sources ?? []) if (prohibitedSourceFor(url)) reasons.push(`source host ${url} is prohibited`);
    }
    if (!existsSync(join(ROOT, task.rights_record))) reasons.push(`rights record ${task.rights_record} is missing`);
    for (const host of task.allowed_hosts) if (prohibitedSourceFor(host)) reasons.push(`host ${host} is prohibited`);
    return {
      ...task,
      rights: entry?.rights ?? null,
      stage: entry?.stage ?? null,
      enabled: reasons.length === 0,
      refused_because: reasons,
    };
  });
  // Every registered source with its acquisition status, so the collector can plan capture for whatever datasets
  // Data Foundry is hosting: `task` (an approved collector task exists), `permitted-no-adapter` (rights and stage
  // permit acquisition, but the adapter is a reviewed code change still to be built) or `blocked` (with reasons).
  const sources = Object.fromEntries(
    registry.candidates.map((entry) => {
      const blockers = acquisitionBlockers(entry);
      const own = tasks.filter((task) => task.source === entry.key && task.enabled).map((task) => task.task);
      return [
        entry.key,
        {
          name: entry.name ?? entry.key,
          rights: entry.rights ?? null,
          stage: entry.stage,
          format: entry.format ?? null,
          publisher: entry.publisher ?? null,
          acquisition: own.length > 0 ? 'task' : blockers.length === 0 ? 'permitted-no-adapter' : 'blocked',
          tasks: own,
          blocked_because: blockers,
        },
      ];
    }),
  );
  const datasets = Object.fromEntries((registry.datasets ?? []).map((dataset) => [dataset.key, { name: dataset.name ?? dataset.key, stage: dataset.stage, sources: dataset.sources }]));
  const policy = {
    generated_by: 'tooling/scripts/local-collector-policy.ts',
    registry: REGISTRY,
    registry_sha256: createHash('sha256').update(registryText).digest('hex'),
    tasks,
    datasets,
    sources,
    prohibited_domains: [...new Set(PROHIBITED_SOURCES.map((source) => source.domain))].sort(),
  };
  return `${JSON.stringify(policy, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() as string)) {
  const next = compilePolicy();
  const path = join(ROOT, OUT);
  if (process.argv.includes('--check')) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (current !== next) {
      console.error(`${OUT} is stale; run: pnpm collector:policy`);
      process.exit(1);
    }
    console.log(`${OUT} is current`);
  } else {
    writeFileSync(path, next);
    console.log(`wrote ${OUT}`);
  }
}
