/**
 * A proposed source declaration is a draft nothing loads — and that is exactly
 * why nothing catches its mistakes.
 *
 * `docs/sources/proposed/*.yaml` sits outside the registry loader on purpose:
 * the placement is the control that stops an unreviewed source being acquired.
 * The cost is that no schema, no validator and no test has ever read these
 * files, so a declaration can be wrong for as long as it likes and only reveal
 * it at the worst moment — when a named human has signed the rights packet and
 * `git mv`s the file into `verticals/<slug>/sources/`, which is the one step in
 * the whole procedure that is supposed to be mechanical.
 *
 * These assertions read the drafts without loading them, so a draft can be
 * wrong in review and cannot be wrong on promotion day.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SourceRegistryEntrySchema } from '@data-foundry/source-registry';
import { parse as parseYaml } from 'yaml';

const PROPOSED = fileURLToPath(new URL('../../docs/sources/proposed/', import.meta.url));

/**
 * Parsed as `unknown`, deliberately.
 *
 * Casting to `Record<string, unknown>` would let a scalar or empty YAML
 * document through and turn a malformed draft into a `TypeError` inside an
 * assertion, which reads as a broken test rather than as a bad draft.
 */
const drafts = readdirSync(PROPOSED)
  .filter((file) => file.endsWith('.yaml'))
  .map((file) => ({ file, doc: parseYaml(readFileSync(join(PROPOSED, file), 'utf8')) as unknown }));

describe('every proposed source declaration could actually be promoted', () => {
  it('finds drafts to check', () => {
    // Without this the whole suite passes vacuously the day the directory is
    // renamed or emptied.
    expect(drafts.length).toBeGreaterThan(0);
  });

  /**
   * The whole entry, against the schema the loader will actually use.
   *
   * The first draft of this checked three fields — `source_type`, `status`,
   * `rights_classification` — which caught the defect it was written for and
   * nothing else. A draft missing `rights_policy`, `acquisition_policy` or
   * `provenance_retention` passed it and would still have failed on promotion
   * day, which is the exact failure this file exists to move earlier. Review
   * pointed that out, and it was right.
   */
  it.each(drafts)('$file satisfies the registry schema it will be loaded by', ({ doc }) => {
    const result = SourceRegistryEntrySchema.safeParse(doc);
    const problems = result.success
      ? ''
      : result.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ');
    expect(result.success, problems).toBe(true);
  });

  /**
   * The placement control itself, asserted rather than assumed.
   *
   * If a draft ever carried an acquirable status AND lived here, the only thing
   * standing between it and acquisition would be the directory it happens to be
   * in — which is a control nobody re-checks.
   */
  it.each(drafts)('$file is not already claiming to be approved', ({ doc }) => {
    const entry = doc as Record<string, unknown>;
    expect(entry['status']).toBe('UNDER_REVIEW');
    expect(entry['rights_classification']).toBe('UNREVIEWED');
  });
});
