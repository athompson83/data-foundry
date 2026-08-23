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
import { SOURCE_TYPES, SOURCE_STATUSES, RIGHTS_CLASSIFICATIONS } from '@data-foundry/canonical-schema';
import { parse as parseYaml } from 'yaml';

const PROPOSED = fileURLToPath(new URL('../../docs/sources/proposed/', import.meta.url));

const drafts = readdirSync(PROPOSED)
  .filter((file) => file.endsWith('.yaml'))
  .map((file) => ({ file, doc: parseYaml(readFileSync(join(PROPOSED, file), 'utf8')) as Record<string, unknown> }));

describe('every proposed source declaration could actually be promoted', () => {
  it('finds drafts to check', () => {
    // Without this the whole suite passes vacuously the day the directory is
    // renamed or emptied.
    expect(drafts.length).toBeGreaterThan(0);
  });

  it.each(drafts)('$file declares a source_type the schema and the database accept', ({ doc }) => {
    // The defect this was written for: `GOVERNMENT`, which reads perfectly
    // sensibly and is in neither `SOURCE_TYPES` nor
    // `sources_source_type_allowed`. It would have been found by a Zod error on
    // the day the owner promoted the file.
    expect(SOURCE_TYPES as readonly string[]).toContain(doc['source_type']);
  });

  it.each(drafts)('$file declares a status the schema accepts', ({ doc }) => {
    expect(SOURCE_STATUSES as readonly string[]).toContain(doc['status']);
  });

  it.each(drafts)('$file declares a rights classification the schema accepts', ({ doc }) => {
    expect(RIGHTS_CLASSIFICATIONS as readonly string[]).toContain(doc['rights_classification']);
  });

  /**
   * The placement control itself, asserted rather than assumed.
   *
   * If a draft ever carried an acquirable status AND lived here, the only thing
   * standing between it and acquisition would be the directory it happens to be
   * in — which is a control nobody re-checks.
   */
  it.each(drafts)('$file is not already claiming to be approved', ({ doc }) => {
    expect(doc['status']).toBe('UNDER_REVIEW');
    expect(doc['rights_classification']).toBe('UNREVIEWED');
  });
});
