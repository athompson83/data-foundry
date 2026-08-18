import {
  canPublish,
  policySnapshotId,
  requiresLegalReview,
  type ContentHash,
  type PolicySnapshotId,
  type RightsClassification,
  type RobotsPolicy,
  type SourceStatus,
} from '@data-foundry/canonical-schema';
import type { AcquisitionMethod, SourceRegistryEntry } from '@data-foundry/source-registry';
import { deterministicUuid, sha256Hex, stableStringify } from '../hashing.js';
import type { AcquisitionGateFinding, AcquisitionGateResult } from './gate-types.js';
import type { RobotsDecision } from './robots.js';

/**
 * The "why was this allowed?" record (doc 13, "Provenance requirements").
 *
 * Every artifact carries a `policy_snapshot_id`. Following it must answer, months
 * later and without access to the source registry's current contents: what were
 * this source's rights at the moment we fetched, what did robots say, which
 * acquisition method was approved, and was the fetch permitted or refused.
 *
 * The snapshot id is derived from a hash of the policy *content*, deliberately
 * excluding `captured_at`. A thousand fetches under one unchanged policy produce
 * one snapshot, not a thousand near-identical rows — and a policy change is
 * immediately visible as a new id.
 */
export interface PolicySnapshot {
  readonly id: PolicySnapshotId;
  readonly source_key: string;
  readonly vertical_slug: string;
  readonly source_domain: string;
  /** First time this exact policy state was observed. */
  readonly captured_at: string;

  readonly rights_classification: RightsClassification;
  readonly publishable: boolean;
  readonly requires_legal_review: boolean;
  readonly kill_switch_engaged: boolean;
  readonly source_status: SourceStatus;

  readonly acquisition_method: AcquisitionMethod;
  readonly acquisition_approved: boolean;
  readonly max_requests_per_minute: number | null;

  readonly attribution_required: boolean;
  readonly retain_artifacts: boolean;
  readonly retention_days: number | null;
  readonly legal_hold: boolean;

  readonly robots_policy: RobotsPolicy;
  readonly robots_decision: RobotsDecision;

  readonly gate_allowed: boolean;
  readonly gate_blockers: readonly AcquisitionGateFinding[];
  readonly gate_warnings: readonly AcquisitionGateFinding[];

  /** sha256 over the policy content above, excluding `captured_at`. */
  readonly snapshot_hash: ContentHash;
}

export interface PolicySnapshotInput {
  readonly entry: SourceRegistryEntry;
  readonly gate: AcquisitionGateResult;
  readonly capturedAt: string;
}

type SnapshotContent = Omit<PolicySnapshot, 'id' | 'captured_at' | 'snapshot_hash'>;

function snapshotContent(input: PolicySnapshotInput): SnapshotContent {
  const { entry, gate } = input;
  return {
    source_key: entry.key,
    vertical_slug: entry.vertical_slug,
    source_domain: entry.domain,

    rights_classification: entry.rights_classification,
    publishable: canPublish(entry.rights_classification),
    requires_legal_review: requiresLegalReview(entry.rights_classification),
    kill_switch_engaged: entry.kill_switch_engaged,
    source_status: entry.status,

    acquisition_method: entry.acquisition_policy.method,
    acquisition_approved: entry.acquisition_policy.approved,
    max_requests_per_minute: entry.acquisition_policy.max_requests_per_minute,

    attribution_required: entry.attribution_requirement.required,
    retain_artifacts: entry.provenance_retention.retain_artifacts,
    retention_days: entry.provenance_retention.retention_days,
    legal_hold: entry.provenance_retention.legal_hold,

    robots_policy: entry.robots_policy,
    robots_decision: gate.robots,

    gate_allowed: gate.allowed,
    gate_blockers: gate.blockers,
    gate_warnings: gate.warnings,
  };
}

/** Build a snapshot without persisting it. */
export function buildPolicySnapshot(input: PolicySnapshotInput): PolicySnapshot {
  const content = snapshotContent(input);
  const snapshotHash = sha256Hex(stableStringify(content));
  return {
    ...content,
    id: policySnapshotId(deterministicUuid('data-foundry:policy-snapshot', snapshotHash)),
    captured_at: input.capturedAt,
    snapshot_hash: snapshotHash,
  };
}

/**
 * Where policy snapshots are persisted. The ingest worker backs this with the
 * `policy_snapshots` table; CI backs it with a Map.
 */
export interface PolicySnapshotRecorder {
  /** Idempotent: recording an unchanged policy returns the existing snapshot. */
  record(input: PolicySnapshotInput): Promise<PolicySnapshot>;
  get(id: PolicySnapshotId): Promise<PolicySnapshot | null>;
  list(): Promise<readonly PolicySnapshot[]>;
}

export class InMemoryPolicySnapshotRecorder implements PolicySnapshotRecorder {
  readonly #byId = new Map<PolicySnapshotId, PolicySnapshot>();

  record(input: PolicySnapshotInput): Promise<PolicySnapshot> {
    const snapshot = buildPolicySnapshot(input);
    const existing = this.#byId.get(snapshot.id);
    if (existing !== undefined) return Promise.resolve(existing);
    this.#byId.set(snapshot.id, snapshot);
    return Promise.resolve(snapshot);
  }

  get(id: PolicySnapshotId): Promise<PolicySnapshot | null> {
    return Promise.resolve(this.#byId.get(id) ?? null);
  }

  list(): Promise<readonly PolicySnapshot[]> {
    return Promise.resolve([...this.#byId.values()]);
  }

  get size(): number {
    return this.#byId.size;
  }
}
