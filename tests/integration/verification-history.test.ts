/**
 * The "Source verified" badge, stored rather than recomputed.
 *
 * The badge is the strongest claim the product makes to a customer, and it
 * existed only as a pure function: given today's evidence and today's policy,
 * is this value verified? That renders a page and cannot answer the question
 * that actually gets asked — "your export said this was verified in March; on
 * what basis?" Recomputing cannot answer it, because both inputs have moved:
 * evidence is superseded and the policy is rewritten. `verification-policy-v2`
 * already refuses badges `v1` granted.
 *
 * These run the real pipeline against the real database and read the real
 * table. Nothing is stubbed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERIFICATION_POLICY_VERSION } from '../../packages/provenance/src/index.js';
import { createFactory, RUN_1_AT, RUN_2_AT, type Factory } from '../support/harness.js';

let factory: Factory;

type VerificationRow = {
  entity_id: string;
  property: string;
  fact_id: string;
  verified: boolean;
  blockers: string[];
  reason: string;
  policy_version: string;
  evaluated_at: string;
  selection_rule: string;
  evidence_refs: Array<Record<string, string>>;
  selected_value: unknown;
};

const verifications = async (): Promise<VerificationRow[]> =>
  factory.driver.query<VerificationRow>(
    `SELECT entity_id::text AS entity_id, property, fact_id::text AS fact_id, verified,
            blockers, reason, policy_version, evaluated_at::text AS evaluated_at,
            selection_rule, evidence_refs, selected_value
       FROM fact_verifications
      ORDER BY entity_id, property`,
  );

beforeAll(async () => {
  factory = await createFactory('hvac');
  await factory.run({ at: RUN_1_AT, runId: 'cycle-1' });
}, 300_000);

afterAll(async () => {
  await factory?.close();
});

describe('verification verdicts are persisted with the policy that produced them', () => {
  it('records a verdict for every published property', async () => {
    const rows = await verifications();
    expect(rows.length).toBeGreaterThan(0);

    const [published] = await factory.driver.query<{ n: string }>(
      `SELECT count(DISTINCT (entity_id, property))::text AS n
         FROM facts WHERE valid_to IS NULL AND status = 'ACTIVE'`,
    );
    expect(rows.length).toBe(Number(published?.n));
  });

  it('stamps the policy version, so an old verdict stays readable after a policy change', async () => {
    const rows = await verifications();
    for (const row of rows) {
      expect(row.policy_version).toBe(VERIFICATION_POLICY_VERSION);
      expect(row.policy_version).not.toBe('');
    }
  });

  it('preserves the selected value, the deciding rule and the evaluation instant', async () => {
    const [row] = await verifications();
    expect(row!.selected_value).toBeDefined();
    expect(row!.selection_rule.length).toBeGreaterThan(0);
    expect(new Date(row!.evaluated_at).toISOString()).toBe(RUN_1_AT);
  });

  it('preserves evidence by content hash, so the verdict is re-checkable against the bytes', async () => {
    const rows = await verifications();
    const withEvidence = rows.filter((row) => row.evidence_refs.length > 0);
    expect(withEvidence.length).toBeGreaterThan(0);

    for (const row of withEvidence) {
      for (const ref of row.evidence_refs) {
        expect(ref['content_hash']).toMatch(/^[0-9a-f]{64}$/);
        const [artifact] = await factory.driver.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM source_artifacts WHERE id = $1 AND content_hash = $2`,
          [String(ref['artifact_id']), String(ref['content_hash'])],
        );
        expect(Number(artifact?.n)).toBe(1);
      }
    }
  });

  it('records the outcome and its blockers together, never one without the other', async () => {
    for (const row of await verifications()) {
      expect(row.verified).toBe(row.blockers.length === 0);
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });

  it('refuses to store a verdict that contradicts its own blockers', async () => {
    const [row] = await verifications();
    await expect(
      factory.driver.query(
        `INSERT INTO fact_verifications
           (entity_id, property, fact_id, selected_value, verified, reason, blockers, signals,
            evidence_refs, selection_rule, policy_version, evaluated_at, verdict_fingerprint)
         VALUES ($1, $2, $3, '1'::jsonb, TRUE, 'contradiction',
                 ARRAY['NO_EVIDENCE']::text[], '{}'::jsonb, '[]'::jsonb, 'RECENCY', 'x', $4, $5)`,
        [row!.entity_id, row!.property, row!.fact_id, RUN_1_AT, 'a'.repeat(64)],
      ),
    ).rejects.toThrow(/fact_verifications_verified_has_no_blockers/);
  });

  it('refuses a blocker code nothing can later explain', async () => {
    const [row] = await verifications();
    await expect(
      factory.driver.query(
        `INSERT INTO fact_verifications
           (entity_id, property, fact_id, selected_value, verified, reason, blockers, signals,
            evidence_refs, selection_rule, policy_version, evaluated_at, verdict_fingerprint)
         VALUES ($1, $2, $3, '1'::jsonb, FALSE, 'unknown code',
                 ARRAY['VIBES_WERE_OFF']::text[], '{}'::jsonb, '[]'::jsonb, 'RECENCY', 'x', $4, $5)`,
        [row!.entity_id, row!.property, row!.fact_id, RUN_1_AT, 'b'.repeat(64)],
      ),
    ).rejects.toThrow(/fact_verifications_blockers_known/);
  });

  it('does not append a second verdict when nothing about the claim changed', async () => {
    const before = await verifications();

    // A full cold re-run on a later day: every byte re-fetched, the cascade
    // re-run, the badge re-evaluated. Same claim, same evidence, same policy —
    // the same verdict, not a new one.
    await factory.run({ at: RUN_2_AT, runId: 'cycle-2' });

    const after = await verifications();
    expect(after.length).toBe(before.length);
    // The original evaluation instant survives: it says when this verdict was
    // actually reached, not when it was last confirmed.
    expect(after.map((row) => row.evaluated_at)).toEqual(before.map((row) => row.evaluated_at));
  }, 300_000);
});
