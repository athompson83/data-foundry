import { describe, expect, it } from 'vitest';
import { compileSourcePlans } from '../../../services/ingest-worker/src/compile.js';
import { loadVerticalConfig } from '../../../services/ingest-worker/src/config.js';
import { qualifyIngestionSources } from '../../../tooling/scripts/compile-ingestion-runtime.js';
import { ACQUISITION_RUNTIMES } from '../../acquisition-worker/generated/runtime-registry.js';

describe('compiled source target qualification', () => {
  it('refuses multiple acquisition targets sharing source-wide snapshot ownership', async () => {
    const plans = compileSourcePlans(await loadVerticalConfig('hvac'));
    const targets = ACQUISITION_RUNTIMES['hvac']!.targets;
    const support = qualifyIngestionSources(plans, [...targets, { ...targets[0]!, target_id: 'independent-second-target' }]);
    expect(support.supported_source_keys).not.toContain('acme-hvac-catalog');
    expect(support.source_targets.some(target => target.source_key === 'acme-hvac-catalog')).toBe(false);
    expect(support.unsupported_sources).toContainEqual({ source_key: 'acme-hvac-catalog', formats: ['json'], reason: 'SOURCE_TARGET_PARTITION_REQUIRED' });
    expect(support.supported_source_keys).toContain('ahri-directory-export');
  });
});
