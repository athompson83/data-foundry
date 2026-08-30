import { z } from 'zod';

/**
 * Branded identifiers.
 *
 * Every table's primary key gets its own nominal type. `EntityId` and
 * `SourceId` are both UUID strings at runtime, but passing one where the other
 * is expected is a compile error — which is the whole point, because the
 * pipeline threads a dozen different UUIDs through the same function
 * signatures.
 */
function uuidId<B extends string>() {
  return z.uuid().brand<B>();
}

export const VerticalIdSchema = uuidId<'VerticalId'>();
export type VerticalId = z.infer<typeof VerticalIdSchema>;

export const SourceIdSchema = uuidId<'SourceId'>();
export type SourceId = z.infer<typeof SourceIdSchema>;

export const SourceArtifactIdSchema = uuidId<'SourceArtifactId'>();
export type SourceArtifactId = z.infer<typeof SourceArtifactIdSchema>;

export const SourceRecordIdSchema = uuidId<'SourceRecordId'>();
export type SourceRecordId = z.infer<typeof SourceRecordIdSchema>;

export const EntityIdSchema = uuidId<'EntityId'>();
export type EntityId = z.infer<typeof EntityIdSchema>;

export const EntityAliasIdSchema = uuidId<'EntityAliasId'>();
export type EntityAliasId = z.infer<typeof EntityAliasIdSchema>;

export const EntityAliasClaimIdSchema = uuidId<'EntityAliasClaimId'>();
export type EntityAliasClaimId = z.infer<typeof EntityAliasClaimIdSchema>;

export const FactIdSchema = uuidId<'FactId'>();
export type FactId = z.infer<typeof FactIdSchema>;

export const FactVerificationIdSchema = uuidId<'FactVerificationId'>();
export type FactVerificationId = z.infer<typeof FactVerificationIdSchema>;

export const FactEvidenceIdSchema = uuidId<'FactEvidenceId'>();
export type FactEvidenceId = z.infer<typeof FactEvidenceIdSchema>;

export const RelationshipIdSchema = uuidId<'RelationshipId'>();
export type RelationshipId = z.infer<typeof RelationshipIdSchema>;

export const RelationshipEvidenceIdSchema = uuidId<'RelationshipEvidenceId'>();
export type RelationshipEvidenceId = z.infer<typeof RelationshipEvidenceIdSchema>;

export const ResolutionCandidateIdSchema = uuidId<'ResolutionCandidateId'>();
export type ResolutionCandidateId = z.infer<typeof ResolutionCandidateIdSchema>;

export const ResolutionJudgmentIdSchema = uuidId<'ResolutionJudgmentId'>();
export type ResolutionJudgmentId = z.infer<typeof ResolutionJudgmentIdSchema>;

export const EntityRedirectIdSchema = uuidId<'EntityRedirectId'>();
export type EntityRedirectId = z.infer<typeof EntityRedirectIdSchema>;

export const DatasetSnapshotIdSchema = uuidId<'DatasetSnapshotId'>();
export type DatasetSnapshotId = z.infer<typeof DatasetSnapshotIdSchema>;

export const MediaAssetIdSchema = uuidId<'MediaAssetId'>();
export type MediaAssetId = z.infer<typeof MediaAssetIdSchema>;

export const IngestionJobIdSchema = uuidId<'IngestionJobId'>();
export type IngestionJobId = z.infer<typeof IngestionJobIdSchema>;

export const PolicySnapshotIdSchema = uuidId<'PolicySnapshotId'>();
export type PolicySnapshotId = z.infer<typeof PolicySnapshotIdSchema>;

/**
 * Source-native business key for a record (a part number, a listing id, a row
 * hash). Unique per source, never assumed unique across sources.
 */
export const SourceRecordKeySchema = z.string().min(1).max(512);
export type SourceRecordKey = z.infer<typeof SourceRecordKeySchema>;

export const verticalId = (value: string): VerticalId => VerticalIdSchema.parse(value);
export const sourceId = (value: string): SourceId => SourceIdSchema.parse(value);
export const sourceArtifactId = (value: string): SourceArtifactId =>
  SourceArtifactIdSchema.parse(value);
export const sourceRecordId = (value: string): SourceRecordId => SourceRecordIdSchema.parse(value);
export const entityId = (value: string): EntityId => EntityIdSchema.parse(value);
export const entityAliasId = (value: string): EntityAliasId => EntityAliasIdSchema.parse(value);
export const entityAliasClaimId = (value: string): EntityAliasClaimId =>
  EntityAliasClaimIdSchema.parse(value);
export const factId = (value: string): FactId => FactIdSchema.parse(value);
export const factEvidenceId = (value: string): FactEvidenceId => FactEvidenceIdSchema.parse(value);
export const relationshipId = (value: string): RelationshipId => RelationshipIdSchema.parse(value);
export const relationshipEvidenceId = (value: string): RelationshipEvidenceId =>
  RelationshipEvidenceIdSchema.parse(value);
export const resolutionCandidateId = (value: string): ResolutionCandidateId =>
  ResolutionCandidateIdSchema.parse(value);
export const resolutionJudgmentId = (value: string): ResolutionJudgmentId =>
  ResolutionJudgmentIdSchema.parse(value);
export const entityRedirectId = (value: string): EntityRedirectId =>
  EntityRedirectIdSchema.parse(value);
export const datasetSnapshotId = (value: string): DatasetSnapshotId =>
  DatasetSnapshotIdSchema.parse(value);
export const mediaAssetId = (value: string): MediaAssetId => MediaAssetIdSchema.parse(value);
export const ingestionJobId = (value: string): IngestionJobId => IngestionJobIdSchema.parse(value);
export const policySnapshotId = (value: string): PolicySnapshotId =>
  PolicySnapshotIdSchema.parse(value);
