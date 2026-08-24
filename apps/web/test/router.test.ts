/**
 * `matchPageClass` against the REAL compiled `hvac.web-runtime.json` — not a
 * hand-written double of `seo.yaml`'s shape, so a change to the real file that
 * breaks routing breaks this test rather than an assumption about it.
 */
import { describe, expect, it } from 'vitest';
import { matchPageClass } from '../src/router.js';
import type { WebRuntime } from '../src/seo.js';
import hvacRuntime from '../generated/hvac.web-runtime.json' with { type: 'json' };

const runtime = hvacRuntime as WebRuntime;
const seo = runtime.seo;

describe('matchPageClass against the compiled hvac runtime', () => {
  it('matches the dataset landing page with no params', () => {
    const match = matchPageClass(seo, '/data/hvac');
    expect(match?.pageClass.id).toBe('dataset_landing');
    expect(match?.params).toEqual({});
  });

  it('matches an equipment model detail page and captures the slug', () => {
    const match = matchPageClass(seo, '/data/hvac/equipment/acme-24acc636a003');
    expect(match?.pageClass.id).toBe('equipment_model_detail');
    expect(match?.params['canonical_slug']).toBe('acme-24acc636a003');
  });

  it('matches the replacement page and NOT the entity detail page for the same slug', () => {
    const match = matchPageClass(seo, '/data/hvac/equipment/acme-24acb636a003/replacements');
    expect(match?.pageClass.id).toBe('replacement_relationship');
  });

  it('matches a manufacturer detail page', () => {
    const match = matchPageClass(seo, '/data/hvac/manufacturers/acme');
    expect(match?.pageClass.id).toBe('manufacturer_detail');
  });

  it('matches a certification detail page', () => {
    const match = matchPageClass(seo, '/data/hvac/certifications/ahri-123456');
    expect(match?.pageClass.id).toBe('certification_detail');
  });

  it('matches the static docs page with no captured params', () => {
    const match = matchPageClass(seo, '/data/hvac/docs');
    expect(match?.pageClass.id).toBe('docs_api_mcp');
    expect(match?.params).toEqual({});
  });

  it('matches nothing for an unrelated path', () => {
    expect(matchPageClass(seo, '/data/hvac/nonsense/path')).toBeNull();
  });

  it('does not match a slug containing a slash as a single segment', () => {
    // {canonical_slug} is `[^/]+` deliberately — a value containing "/" would
    // otherwise let one path segment masquerade as two, which is exactly the
    // ambiguity a route pattern exists to rule out.
    expect(matchPageClass(seo, '/data/hvac/equipment/a/b')).toBeNull();
  });
});
