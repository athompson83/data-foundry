import type {
  RefreshPolicy,
  RightsAssetClass,
  RightsOutputClass,
  VerticalStatus,
} from '@data-foundry/canonical-schema';
import type { SourceRegistryEntry } from '@data-foundry/source-registry';
import type { AcquisitionResultUrlPolicy } from './types.js';

/** One exact, rights-scoped request target compiled for an acquisition Worker. */
export interface AcquisitionRuntimeTarget {
  readonly target_id: string;
  readonly target_url: string;
  readonly asset_class: RightsAssetClass;
  readonly output_class: RightsOutputClass;
  /** Exact host/path boundary for target and multi-resource provider results. */
  readonly result_url_policy: AcquisitionResultUrlPolicy;
  readonly source: SourceRegistryEntry;
}

/** Filesystem-free runtime configuration consumed by the scheduled Worker. */
export interface AcquisitionRuntime {
  readonly schema_version: 1;
  readonly vertical_slug: string;
  /** Canonical vertical row fields needed by the filesystem-free write path. */
  readonly vertical_name: string;
  readonly vertical_schema_version: string;
  readonly vertical_status: VerticalStatus;
  readonly default_refresh_policy: RefreshPolicy;
  readonly targets: readonly AcquisitionRuntimeTarget[];
  /** SHA-256 of the runtime payload before this field is attached. */
  readonly runtime_digest: string;
}
