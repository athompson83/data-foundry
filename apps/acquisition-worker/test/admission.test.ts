import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixtures, type Fixtures } from '../../../packages/canonical-store/test/support.js';
import { ACQUISITION_RUNTIMES } from '../generated/runtime-registry.js';
import {
  StoredAcquisitionRefusal,
  authorizeStoredAcquisition,
  plannerAdmission,
  recheckStoredAcquisition,
  type StoredAcquisitionScope,
  type StoredAcquisitionCapability,
} from '../src/admission.js';
import { seedAcquisitionRights } from './support.js';

const NOW = '2026-08-28T17:00:00.000Z';
let fixtures: Fixtures;
let scope: StoredAcquisitionScope;
let capability: StoredAcquisitionCapability;

beforeAll(async () => {
  fixtures = await createFixtures({ trigram: false });
  const target = ACQUISITION_RUNTIMES['hvac']!.targets[0]!;
  scope = {
    sourceId: fixtures.sources.manufacturer.source.id,
    sourceKey: target.source.key,
    targetId: target.target_id,
    targetUrl: target.target_url,
    acquisitionRoute: target.source.acquisition_policy.method,
    accountOrProductPlan: target.source.acquisition_policy.account_or_product_plan,
    jurisdiction: target.source.acquisition_policy.jurisdiction,
    assetClass: target.asset_class,
    outputClass: target.output_class,
    rightsScopeDigest: 'a'.repeat(64),
  };
});

afterAll(async () => fixtures?.driver.close());

describe('stored acquisition admission', () => {
  it('fails closed with a structured receipt when no grant exists', async () => {
    const error = await authorizeStoredAcquisition(fixtures.driver, scope, NOW, 'INITIAL').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StoredAcquisitionRefusal);
    expect((error as StoredAcquisitionRefusal).receipt.decisions).toHaveLength(3);
    expect((error as StoredAcquisitionRefusal).receipt).toMatchObject({
      basis: 'RIGHTS_REFUSED',
      scopeDigest: scope.rightsScopeDigest,
    });
    expect((error as StoredAcquisitionRefusal).receipt.decisions.every((decision) => !decision.permitted)).toBe(true);
  });

  it('creates an opaque capability only from exact stored grants', async () => {
    await seedAcquisitionRights({
      driver: fixtures.driver,
      sourceId: scope.sourceId,
      acquisitionRoute: scope.acquisitionRoute,
      assetClass: scope.assetClass,
      outputClass: scope.outputClass,
    });
    const admitted = await authorizeStoredAcquisition(fixtures.driver, scope, NOW, 'INITIAL');
    capability = admitted.capability;
    expect(admitted.receipt).toMatchObject({ basis: 'ADMITTED', scopeDigest: scope.rightsScopeDigest });
    const admission = plannerAdmission(admitted.capability, admitted.receipt);
    expect(admission).toMatchObject({
      sourceId: scope.sourceId,
      targetId: scope.targetId,
      targetUrl: scope.targetUrl,
      assetClass: scope.assetClass,
    });

    await expect(
      recheckStoredAcquisition({} as never, fixtures.driver, NOW, 'PRE_PROVIDER'),
    ).rejects.toThrow(/trusted acquisition capability/i);
  });

  it('rechecks the stored kill switch instead of replaying admission', async () => {
    await fixtures.driver.query(
      `UPDATE sources SET kill_switch_engaged = TRUE WHERE id = $1`,
      [scope.sourceId],
    );
    const admitted = await recheckStoredAcquisition(capability, fixtures.driver, NOW, 'PRE_TRANSPORT').catch(
      (error: unknown) => error,
    );
    expect(admitted).toBeInstanceOf(StoredAcquisitionRefusal);
    expect((admitted as StoredAcquisitionRefusal).receipt.decisions[0]).toMatchObject({
      permitted: false,
      reasonCode: 'KILL_SWITCH_ENGAGED',
    });
  });
});
