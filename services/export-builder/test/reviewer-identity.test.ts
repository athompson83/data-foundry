/**
 * A staff reviewer's name, and our own notes about a source, must not leave in
 * a customer file.
 *
 * `@data-foundry/query-model` has documented the reviewer half since it was
 * written — "the REVIEWER IDENTITY is never projected onto any of these shapes"
 * — and ships `assertNoReviewerIdentity` as the control. The control checks a
 * correction's reason against THAT correction's reviewer, which is all it has.
 *
 * An export knows the whole compiled policy, and that turns out to matter: a
 * reason attached to the standards desk's override that names the editorial
 * desk's reviewer passes the query layer completely. The first test below
 * demonstrates that gap directly — `canonicalFacts` returns the row without
 * complaint — and the second shows the export boundary refusing it.
 *
 * The manifest half is checked against the SERIALIZED BYTES rather than the
 * object, because the failure being guarded is a field nobody thought to check.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReviewerIdentityLeak } from '@data-foundry/query-model';
import type { EditorialOverride } from '@data-foundry/canonical-store';
import {
  InternalTextLeak,
  assertNoInternalText,
  buildDatasetExport,
  createMemorySink,
  declaredReviewers,
  fromUtf8,
  internalOnlyText,
} from '../src/index.js';
import {
  GENERATED_AT,
  PUBLIC_PROPERTIES,
  baseOptions,
  createExportFixtures,
  registryEntry,
  type ExportFixtures,
} from './support.js';

let fixtures: ExportFixtures;

/** The desk that made the claim, and the reviewer who signed the correction. */
const CORRECTION_REVIEWER = 'm.chen@example.com';
/** A different reviewer, named elsewhere in the same compiled policy. */
const OTHER_REVIEWER = 'j.okafor@example.com';

const CLEAN_REASON =
  'The 2026 product literature restated the refrigerant designation; corrected to the value on ' +
  'the AHRI certification listing.';
const LEAKY_REASON = 'Corrected by j.okafor after a supplier call about the 2026 designation.';

/** An override the standards desk declares but which decides nothing here. */
const UNRELATED_OVERRIDE: EditorialOverride = {
  source: 'standards-desk.internal',
  properties: ['tonnage'],
  reason: 'Standards desk restated nominal tonnage from the rating table.',
  reviewer: OTHER_REVIEWER,
};

const overrides = (reason: string): readonly EditorialOverride[] => [
  {
    source: 'editorial.internal',
    properties: ['refrigerant'],
    reason,
    reviewer: CORRECTION_REVIEWER,
  },
  UNRELATED_OVERRIDE,
];

beforeAll(async () => {
  fixtures = await createExportFixtures();
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('the gap the export boundary closes', () => {
  it('the query layer serves a reason naming another policy reviewer without complaint', async () => {
    const views = await fixtures.qm.canonicalFacts(fixtures.equipment.id, {
      at: GENERATED_AT,
      editorialOverrides: [...overrides(LEAKY_REASON)],
    });
    const refrigerant = views.find((view) => view.property === 'refrigerant');
    expect(refrigerant?.editorially_corrected).toBe(true);
    expect(refrigerant?.editorial_correction_reason).toBe(LEAKY_REASON);
    // It checked the reason against m.chen, the reviewer of THIS correction.
    // The name in the reason belongs to a different reviewer in the same policy.
    expect(refrigerant?.editorial_correction_reason).toContain('j.okafor');
  });

  it('the export refuses it, and writes nothing', async () => {
    const sink = createMemorySink('leak');
    let error: unknown;
    try {
      await buildDatasetExport({
        ...baseOptions(fixtures),
        sink,
        selection: { at: GENERATED_AT, editorialOverrides: [...overrides(LEAKY_REASON)] },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReviewerIdentityLeak);
    expect((error as ReviewerIdentityLeak).field).toBe('editorialCorrectionReason');
    expect(sink.files.size).toBe(0);
  });

  it('does not repeat the identity in the error it throws', async () => {
    const sink = createMemorySink('leak');
    let error: unknown;
    try {
      await buildDatasetExport({
        ...baseOptions(fixtures),
        sink,
        selection: { at: GENERATED_AT, editorialOverrides: [...overrides(LEAKY_REASON)] },
      });
    } catch (caught) {
      error = caught;
    }
    // An error string ends up in logs and exception trackers; a guard that
    // reprints what it is guarding has published it a second time.
    expect((error as Error).message).not.toContain('j.okafor');
    expect((error as Error).message).not.toContain('okafor');
  });
});

describe('a clean correction publishes its reason and nothing about its reviewer', () => {
  it('publishes the correction on the row', async () => {
    const sink = createMemorySink('corrected');
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      sink,
      selection: { at: GENERATED_AT, editorialOverrides: [...overrides(CLEAN_REASON)] },
    });
    const row = result.rows.find(
      (candidate) =>
        candidate.property === 'refrigerant' &&
        candidate.entity_slug === 'carrier-infinity-24anb7',
    );
    expect(row?.value).toBe('R-32');
    expect(row?.rule).toBe('EDITORIAL_OVERRIDE');
    expect(row?.editorially_corrected).toBe(true);
    expect(row?.editorial_correction_reason).toBe(CLEAN_REASON);
  });

  it('records the override in the manifest with a reason and no reviewer field', async () => {
    const sink = createMemorySink('corrected');
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      sink,
      selection: { at: GENERATED_AT, editorialOverrides: [...overrides(CLEAN_REASON)] },
    });
    const declared = result.manifest.selection_policy.editorial_overrides;
    expect(declared).toHaveLength(2);
    for (const override of declared) {
      expect(Object.keys(override).sort()).toEqual(['properties', 'reason', 'source']);
      expect(JSON.stringify(override)).not.toContain('@example.com');
    }
  });

  it('carries no reviewer identity in any emitted byte', async () => {
    const sink = createMemorySink('corrected');
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      sink,
      selection: { at: GENERATED_AT, editorialOverrides: [...overrides(CLEAN_REASON)] },
    });
    const names = declaredReviewers([...overrides(CLEAN_REASON)], fixtures.sourceRegistry);
    // The set is not empty, or this test would pass by having nothing to find.
    expect(names).toEqual(
      expect.arrayContaining([CORRECTION_REVIEWER, OTHER_REVIEWER, 'legal@example.com']),
    );
    for (const [path, bytes] of result.artifacts) {
      const text = fromUtf8(bytes).toLowerCase();
      for (const name of names) {
        expect(text.includes(name.toLowerCase()), `${name} must not appear in ${path}`).toBe(false);
      }
    }
  });

  it('carries none of our internal notes about a source either', async () => {
    const marked = fixtures.sourceRegistry.map((entry) =>
      entry.key === 'carrier-docs'
        ? registryEntry('carrier-docs', {
            notes: 'INTERNAL: distributor margin renegotiation in progress, do not surface',
          })
        : entry,
    );
    const sink = createMemorySink('notes');
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      sink,
      sourceRegistry: marked,
      properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES },
    });
    const fragments = internalOnlyText(marked);
    expect(fragments.length).toBeGreaterThan(0);
    for (const [path, bytes] of result.artifacts) {
      const text = fromUtf8(bytes).toLowerCase();
      for (const fragment of fragments) {
        expect(text.includes(fragment.toLowerCase()), `${path} must not carry "${fragment}"`).toBe(
          false,
        );
      }
    }
    expect(fromUtf8(result.artifacts.get('manifest.json') as Uint8Array)).not.toContain(
      'renegotiation',
    );
  });
});

describe('the internal-text sweep itself refuses when it finds something', () => {
  it('throws InternalTextLeak, naming the artifact and not the text', () => {
    const fragment = 'INTERNAL: distributor margin renegotiation in progress';
    let error: unknown;
    try {
      assertNoInternalText('manifest.json', `{"notes":"${fragment}"}`, [fragment]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InternalTextLeak);
    expect((error as InternalTextLeak).artifact).toBe('manifest.json');
    expect((error as Error).message).not.toContain('renegotiation');
  });

  it('ignores fragments too short to be evidence of anything', () => {
    expect(internalOnlyText([registryEntry('carrier-docs', { notes: 'short' })])).not.toContain(
      'short',
    );
  });
});
