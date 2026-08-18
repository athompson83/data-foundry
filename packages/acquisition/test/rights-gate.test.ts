import { describe, expect, it } from 'vitest';
import { RightsViolationError } from '@data-foundry/canonical-schema';
import { AcquisitionRefusedError, RobotsDisallowedError } from '../src/errors.js';
import { evaluateAcquisitionGate } from '../src/policy/rights-gate.js';
import { HttpAcquisitionProvider } from '../src/providers/http.js';
import type { AcquisitionGateCode } from '../src/policy/gate-types.js';
import {
  BODY,
  ETAG,
  NOW,
  TARGET_URL,
  compliantEntry,
  forbiddenFetch,
  makeHarness,
  makeRequest,
  stubFetch,
} from './helpers.js';
import type { SourceRegistryEntry } from '@data-foundry/source-registry';

const codes = (entry: SourceRegistryEntry, url = TARGET_URL): AcquisitionGateCode[] =>
  evaluateAcquisitionGate({ entry, url, asOf: NOW }).blockers.map((blocker) => blocker.code);

describe('acquisition gate — evaluation', () => {
  it('allows a fully-compliant GREEN source', () => {
    const result = evaluateAcquisitionGate({ entry: compliantEntry(), url: TARGET_URL, asOf: NOW });
    expect(result.blockers).toEqual([]);
    expect(result.allowed).toBe(true);
    expect(result.robots.allowed).toBe(true);
    expect(result.robots.crawlDelaySeconds).toBe(2);
  });

  it.each(['RED', 'UNREVIEWED'] as const)('blocks %s rights outright', (rights) => {
    expect(codes(compliantEntry({ rights_classification: rights }))).toContain('RIGHTS_BLOCKED');
  });

  it('permits AMBER acquisition but warns that publication still needs sign-off', () => {
    const result = evaluateAcquisitionGate({
      entry: compliantEntry({ rights_classification: 'AMBER' }),
      url: TARGET_URL,
      asOf: NOW,
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain('RIGHTS_BLOCKED');
  });

  it('blocks an engaged kill switch', () => {
    expect(codes(compliantEntry({ kill_switch_engaged: true }))).toContain('KILL_SWITCH_ENGAGED');
  });

  it.each(['SUSPENDED', 'RETIRED', 'PAUSED', 'PROPOSED'] as const)(
    'blocks acquisition from a %s source',
    (status) => {
      expect(codes(compliantEntry({ status }))).toContain('SOURCE_NOT_ACQUIRABLE');
    },
  );

  it('blocks an unapproved acquisition method', () => {
    const entry = compliantEntry();
    expect(
      codes({
        ...entry,
        acquisition_policy: { ...entry.acquisition_policy, approved: false },
      }),
    ).toContain('ACQUISITION_METHOD_NOT_APPROVED');
  });

  it('blocks a provider that does not implement the approved method', () => {
    const result = evaluateAcquisitionGate({
      entry: compliantEntry(),
      url: TARGET_URL,
      asOf: NOW,
      providerMethods: ['BROWSER_RUN'],
    });
    expect(result.blockers.map((blocker) => blocker.code)).toContain('ACQUISITION_METHOD_MISMATCH');
  });

  it('blocks a URL that does not belong to the declared source domain', () => {
    expect(codes(compliantEntry(), 'https://evil.example.com/certified/units.json')).toContain(
      'URL_NOT_IN_SOURCE_SCOPE',
    );
  });

  it('allows a subdomain of the declared source domain', () => {
    expect(codes(compliantEntry(), 'https://data.ahridirectory.org/x.json')).toEqual([]);
  });

  it('blocks a robots-disallowed path', () => {
    const entry = compliantEntry();
    expect(
      codes(
        {
          ...entry,
          robots_policy: { ...entry.robots_policy, disallowed_paths: ['/certified'] },
        },
        TARGET_URL,
      ),
    ).toContain('ROBOTS_DISALLOWED');
  });

  it('blocks a source that would discard its own evidence', () => {
    expect(
      codes(
        compliantEntry({
          provenance_retention: { retain_artifacts: false, retention_days: null, legal_hold: false },
        }),
      ),
    ).toContain('PROVENANCE_RETENTION_NOT_CONFIGURED');
  });

  it('reports every blocker rather than the first', () => {
    const result = evaluateAcquisitionGate({
      entry: compliantEntry({ rights_classification: 'RED', kill_switch_engaged: true }),
      url: 'https://elsewhere.example.com/x',
      asOf: NOW,
    });
    expect(new Set(result.blockers.map((blocker) => blocker.code))).toEqual(
      new Set(['RIGHTS_BLOCKED', 'KILL_SWITCH_ENGAGED', 'URL_NOT_IN_SOURCE_SCOPE']),
    );
  });
});

describe('acquisition gate — refusal happens before the network (AGENTS.md rule 1)', () => {
  const refusalCases = [
    { name: 'RED rights', entry: compliantEntry({ rights_classification: 'RED' }) },
    { name: 'UNREVIEWED rights', entry: compliantEntry({ rights_classification: 'UNREVIEWED' }) },
    { name: 'engaged kill switch', entry: compliantEntry({ kill_switch_engaged: true }) },
  ] as const;

  it.each(refusalCases)('$name never reaches the transport', async ({ entry }) => {
    const harness = makeHarness({ entry });
    const net = forbiddenFetch();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(RightsViolationError);
    expect(net.calls).toEqual([]);
  });

  it('refuses an undeclared source as UNREVIEWED', async () => {
    const harness = makeHarness();
    const net = forbiddenFetch();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(
      provider.fetch(makeRequest({ sourceKey: 'never-declared' })),
    ).rejects.toBeInstanceOf(RightsViolationError);
    expect(net.calls).toEqual([]);
  });

  it('refuses a robots-disallowed path without asking the origin', async () => {
    const entry = compliantEntry();
    const harness = makeHarness({
      entry: {
        ...entry,
        robots_policy: { ...entry.robots_policy, disallowed_paths: ['/certified'] },
      },
    });
    const net = forbiddenFetch();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(net.calls).toEqual([]);
  });

  it('refuses an unapproved acquisition method without asking the origin', async () => {
    const entry = compliantEntry();
    const harness = makeHarness({
      entry: { ...entry, acquisition_policy: { ...entry.acquisition_policy, approved: false } },
    });
    const net = forbiddenFetch();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    const error = await provider.fetch(makeRequest()).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AcquisitionRefusedError);
    expect((error as AcquisitionRefusedError).code).toBe('ACQUISITION_METHOD_NOT_APPROVED');
    expect(net.calls).toEqual([]);
  });

  it('records the refusal as a policy snapshot so it can be explained later', async () => {
    const harness = makeHarness({ entry: compliantEntry({ rights_classification: 'RED' }) });
    const net = forbiddenFetch();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(RightsViolationError);

    const snapshots = await harness.recorder.list();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.gate_allowed).toBe(false);
    expect(snapshots[0]?.rights_classification).toBe('RED');
    expect(snapshots[0]?.publishable).toBe(false);
  });

  it('writes nothing to the evidence store when it refuses', async () => {
    const harness = makeHarness({ entry: compliantEntry({ rights_classification: 'RED' }) });
    const net = forbiddenFetch();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(RightsViolationError);
    expect(harness.files.size).toBe(0);
  });

  it('still fetches when everything is in order', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({
      status: 200,
      headers: { 'content-type': 'application/json', etag: ETAG },
      body: BODY,
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    const result = await provider.fetch(makeRequest());
    expect(net.calls).toHaveLength(1);
    expect(result.outcome).toBe('FETCHED');
    expect(result.artifacts).toHaveLength(1);
  });
});
