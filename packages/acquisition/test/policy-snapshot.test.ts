import { describe, expect, it } from 'vitest';
import {
  InMemoryPolicySnapshotRecorder,
  buildPolicySnapshot,
} from '../src/policy/policy-snapshot.js';
import { evaluateAcquisitionGate } from '../src/policy/rights-gate.js';
import { HttpAcquisitionProvider } from '../src/providers/http.js';
import { BODY, ETAG, NOW, TARGET_URL, compliantEntry, makeHarness, makeRequest, stubFetch } from './helpers.js';
import type { SourceRegistryEntry } from '@data-foundry/source-registry';

function snapshotFor(entry: SourceRegistryEntry, capturedAt = NOW, url = TARGET_URL) {
  const gate = evaluateAcquisitionGate({ entry, url, asOf: capturedAt });
  return buildPolicySnapshot({ entry, gate, capturedAt });
}

describe('policy snapshot', () => {
  it('captures the rights and robots state in force at fetch time', () => {
    const snapshot = snapshotFor(compliantEntry());
    expect(snapshot.rights_classification).toBe('GREEN');
    expect(snapshot.publishable).toBe(true);
    expect(snapshot.requires_legal_review).toBe(false);
    expect(snapshot.acquisition_method).toBe('DIRECT_HTTP');
    expect(snapshot.acquisition_approved).toBe(true);
    expect(snapshot.retain_artifacts).toBe(true);
    expect(snapshot.robots_decision.allowed).toBe(true);
    expect(snapshot.robots_policy.crawl_delay_seconds).toBe(2);
    expect(snapshot.gate_allowed).toBe(true);
  });

  it('has an id derived from the policy content, not from randomness', () => {
    expect(snapshotFor(compliantEntry()).id).toBe(snapshotFor(compliantEntry()).id);
    expect(snapshotFor(compliantEntry()).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('ignores capture time, so an unchanged policy is one snapshot not a thousand', () => {
    expect(snapshotFor(compliantEntry(), '2026-08-14T00:00:00.000Z').id).toBe(
      snapshotFor(compliantEntry(), '2027-01-01T00:00:00.000Z').id,
    );
  });

  it('gets a new id the moment the policy changes', () => {
    const baseline = snapshotFor(compliantEntry()).id;
    expect(snapshotFor(compliantEntry({ rights_classification: 'AMBER' })).id).not.toBe(baseline);
    expect(snapshotFor(compliantEntry({ kill_switch_engaged: true })).id).not.toBe(baseline);

    const entry = compliantEntry();
    expect(
      snapshotFor({
        ...entry,
        robots_policy: { ...entry.robots_policy, crawl_delay_seconds: 10 },
      }).id,
    ).not.toBe(baseline);
  });

  it('records a refusal, including every blocker', () => {
    const snapshot = snapshotFor(compliantEntry({ rights_classification: 'RED' }));
    expect(snapshot.gate_allowed).toBe(false);
    expect(snapshot.gate_blockers.map((blocker) => blocker.code)).toContain('RIGHTS_BLOCKED');
    expect(snapshot.publishable).toBe(false);
  });

  it('flags AMBER as needing legal review before publication', () => {
    const snapshot = snapshotFor(compliantEntry({ rights_classification: 'AMBER' }));
    expect(snapshot.publishable).toBe(true);
    expect(snapshot.requires_legal_review).toBe(true);
    expect(snapshot.gate_warnings.length).toBeGreaterThan(0);
  });
});

describe('policy snapshot recorder', () => {
  it('is idempotent for an unchanged policy', async () => {
    const recorder = new InMemoryPolicySnapshotRecorder();
    const entry = compliantEntry();
    const gate = evaluateAcquisitionGate({ entry, url: TARGET_URL, asOf: NOW });

    const first = await recorder.record({ entry, gate, capturedAt: NOW });
    const second = await recorder.record({
      entry,
      gate,
      capturedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(second.id).toBe(first.id);
    expect(second.captured_at).toBe(NOW); // first observation wins
    expect(recorder.size).toBe(1);
  });

  it('is retrievable by id', async () => {
    const recorder = new InMemoryPolicySnapshotRecorder();
    const entry = compliantEntry();
    const gate = evaluateAcquisitionGate({ entry, url: TARGET_URL, asOf: NOW });
    const snapshot = await recorder.record({ entry, gate, capturedAt: NOW });
    expect(await recorder.get(snapshot.id)).toEqual(snapshot);
  });
});

describe('policy snapshot is stamped onto the evidence', () => {
  it('every artifact points at the snapshot that permitted it', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({
      status: 200,
      headers: { 'content-type': 'application/json', etag: ETAG },
      body: BODY,
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    const result = await provider.fetch(makeRequest());

    expect(result.artifacts[0]?.policy_snapshot_id).toBe(result.policySnapshot.id);
    expect(result.stored[0]?.metadata.policy_snapshot_id).toBe(result.policySnapshot.id);
    expect(await harness.recorder.get(result.policySnapshot.id)).not.toBeNull();
  });
});
