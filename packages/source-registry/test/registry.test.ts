import { describe, expect, it } from 'vitest';
import { verticalId, type Slug } from '@data-foundry/canonical-schema';
import {
  InMemorySourceRegistry,
  SourceRegistryError,
  parseSourceRegistryEntry,
} from '../src/loader.js';
import { deriveSourceHealthState, toSourceInsert } from '../src/entry.js';
import { rightsReviewIsCurrent } from '../src/rights-policy.js';
import { NOW, compliantEntry } from './fixtures.js';

const HVAC = 'hvac' as Slug;

describe('InMemorySourceRegistry', () => {
  it('serves entries by vertical and key', async () => {
    const registry = new InMemorySourceRegistry([
      compliantEntry(),
      compliantEntry({ key: 'acme-catalog', domain: 'catalog.acme-climate.example.com', source_type: 'MANUFACTURER' }),
    ]);

    expect(await registry.listVerticals()).toEqual([HVAC]);
    expect((await registry.listSources(HVAC)).map((entry) => entry.key)).toEqual([
      'ratings-directory',
      'acme-catalog',
    ]);
    expect((await registry.getSource(HVAC, 'ratings-directory'))?.domain).toBe('ratings-directory.example.org');
    expect(await registry.getSource(HVAC, 'nope')).toBeNull();
    expect(await registry.listSources('plumbing' as Slug)).toEqual([]);
  });

  it('rejects duplicate keys within a vertical', () => {
    expect(() => new InMemorySourceRegistry([compliantEntry(), compliantEntry()])).toThrow(
      SourceRegistryError,
    );
  });

  it('validates entries on construction', () => {
    const broken = { ...compliantEntry(), authority_rank: 500 };
    expect(() => new InMemorySourceRegistry([broken])).toThrow();
  });
});

describe('parseSourceRegistryEntry', () => {
  it('accepts a complete declaration', () => {
    const result = parseSourceRegistryEntry(compliantEntry());
    expect(result.ok).toBe(true);
  });

  it('rejects a declaration with no rights metadata and names the fields', () => {
    const { rights_policy: _omitted, ...withoutRights } = compliantEntry();
    const result = parseSourceRegistryEntry(withoutRights);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toContain('rights_policy');
  });

  it('rejects an invalid source key', () => {
    const result = parseSourceRegistryEntry({ ...compliantEntry(), key: 'Ratings Directory' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toContain('key');
  });
});

describe('toSourceInsert', () => {
  it('projects a declaration onto the sources row', () => {
    const id = verticalId('11111111-1111-4111-8111-111111111111');
    const row = toSourceInsert(compliantEntry(), id);
    expect(row.vertical_id).toBe(id);
    expect(row.domain).toBe('ratings-directory.example.org');
    expect(row.rights_classification).toBe('GREEN');
    expect(row.authority_rank).toBe(95);
    expect(row.status).toBe('ACTIVE');
    expect(row.kill_switch_engaged).toBe(false);
    expect(toSourceInsert(compliantEntry({ kill_switch_engaged: true }), id).kill_switch_engaged).toBe(
      true,
    );
  });
});

describe('rightsReviewIsCurrent', () => {
  const policy = compliantEntry().rights_policy;

  it('is false without a named reviewer', () => {
    expect(rightsReviewIsCurrent({ ...policy, reviewed_by: null }, NOW)).toBe(false);
    expect(rightsReviewIsCurrent({ ...policy, reviewed_at: null }, NOW)).toBe(false);
  });

  it('is true for a review with no expiry', () => {
    expect(rightsReviewIsCurrent({ ...policy, next_review_at: null }, NOW)).toBe(true);
  });

  it('expires at the end of the review date, not the start', () => {
    expect(rightsReviewIsCurrent({ ...policy, next_review_at: '2026-08-14' }, NOW)).toBe(true);
    expect(rightsReviewIsCurrent({ ...policy, next_review_at: '2026-08-13' }, NOW)).toBe(false);
  });
});

describe('deriveSourceHealthState', () => {
  it('reports BLOCKED for auth/legal status codes regardless of history', () => {
    for (const status of [401, 403, 451]) {
      expect(
        deriveSourceHealthState({
          last_http_status: status,
          consecutive_failures: 0,
          success_rate_7d: 1,
        }),
      ).toBe('BLOCKED');
    }
  });

  it('reports FAILING after a run of failures', () => {
    expect(
      deriveSourceHealthState({
        last_http_status: 500,
        consecutive_failures: 5,
        success_rate_7d: 0.95,
      }),
    ).toBe('FAILING');
  });

  it('reports UNKNOWN with no measured window', () => {
    expect(
      deriveSourceHealthState({
        last_http_status: null,
        consecutive_failures: 0,
        success_rate_7d: null,
      }),
    ).toBe('UNKNOWN');
  });

  it('reports DEGRADED on a partial success rate or a single recent failure', () => {
    expect(
      deriveSourceHealthState({
        last_http_status: 200,
        consecutive_failures: 0,
        success_rate_7d: 0.8,
      }),
    ).toBe('DEGRADED');
    expect(
      deriveSourceHealthState({
        last_http_status: 200,
        consecutive_failures: 1,
        success_rate_7d: 1,
      }),
    ).toBe('DEGRADED');
  });

  it('reports HEALTHY only when nothing is wrong', () => {
    expect(
      deriveSourceHealthState({
        last_http_status: 200,
        consecutive_failures: 0,
        success_rate_7d: 1,
      }),
    ).toBe('HEALTHY');
  });
});
