import type { SourceRegistryEntry } from '../src/entry.js';

export const NOW = '2026-08-14T00:00:00.000Z';

/**
 * A fully-compliant HVAC source: GREEN, reviewed, approved acquisition,
 * attribution configured, artifacts retained. Every test below starts from this
 * and breaks exactly one thing, so a failure names its own cause.
 */
export function compliantEntry(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    key: 'ratings-directory',
    vertical_slug: 'hvac',
    publisher: 'Federated HVAC Ratings Council (SYNTHETIC — fictional certification body)',
    domain: 'ratings-directory.example.org',
    source_type: 'CERTIFICATION_BODY',
    authority_rank: 95,
    status: 'ACTIVE',
    refresh_cadence: 'WEEKLY',

    rights_classification: 'GREEN',
    attribution_requirement: {
      required: true,
      text: 'Certification data courtesy of the Federated HVAC Ratings Council',
      url: null,
    },
    robots_policy: {
      respect_robots: true,
      user_agent: 'data-foundry-bot',
      crawl_delay_seconds: 2,
      disallowed_paths: ['/admin'],
      allowed_paths: ['/'],
      robots_url: 'https://www.ratings-directory.example.org/robots.txt',
      snapshot_hash: 'a'.repeat(64),
      snapshot_at: '2026-07-01T00:00:00.000Z',
    },

    rights_policy: {
      publisher_legal_entity: 'Federated HVAC Ratings Council (SYNTHETIC — fictional certification body)',
      terms_url: 'https://www.ratings-directory.example.org/terms',
      license_id: null,
      license_text_ref: 'legal/ratings-directory-terms-2026-07-01.pdf',
      api_terms_url: null,
      commercial_use_allowed: true,
      redistribution_allowed: true,
      derivative_normalization_allowed: true,
      attribution: { required: true, text: 'Courtesy of the Federated HVAC Ratings Council', url: null },
      images_reusable: false,
      personal_data_present: false,
      geographic_notes: 'US/Canada certification directory.',
      reviewed_at: '2026-07-01T00:00:00.000Z',
      reviewed_by: 'legal@example.com',
      next_review_at: '2027-07-01',
    },
    acquisition_policy: {
      method: 'DIRECT_HTTP',
      account_or_product_plan: null,
      jurisdiction: null,
      approved: true,
      approved_by: 'legal@example.com',
      approved_at: '2026-07-01T00:00:00.000Z',
      max_requests_per_minute: 30,
      notes: 'Public search endpoint; respects crawl delay.',
    },
    image_policy: {
      images_reusable: false,
      cache_to_r2_permitted: false,
      default_display_modes: [],
      image_attribution: { required: false, text: null, url: null },
    },
    provenance_retention: {
      retain_artifacts: true,
      retention_days: null,
      legal_hold: false,
    },
    license_split: {
      code_license_id: null,
      data_license_id: null,
      notes: 'Directory content is not open-licensed; terms permit factual reuse with attribution.',
    },

    kill_switch_engaged: false,
    notes: '',
    ...overrides,
  };
}
