import { formatLocatorValue, type EvidenceLocator } from './locator.js';
import type { ArchiveSpec, ExtractionSchema } from './schema.js';
import { ExtractionError, type ExtractedRecord, type ExtractionArtifact } from './types.js';
import { extractZipMember, isZipArchive, ZipArchiveError, type ZipLimits, type ZipMember } from './zip.js';

/**
 * Archive-aware extraction.
 *
 * The preserved artifact is the archive exactly as the publisher shipped it —
 * its digest is the evidence digest (AGENTS.md rule 10). Extraction reads the
 * one member the schema names out of those bytes, hands the member to the
 * ordinary format provider, and then re-addresses every locator so it names the
 * member as well as the row and column. Nothing downstream ever sees the member
 * as a separate artifact, and nothing is written anywhere.
 */

/** Locator types whose value uses the `key=value;…` grammar and can carry a member. */
const MEMBER_ADDRESSABLE = new Set(['TABLE_CELL', 'LINE_RANGE', 'PAGE', 'REGEX_MATCH']);

export const archiveLimits = (spec: ArchiveSpec): Partial<ZipLimits> => ({
  ...(spec.max_members === undefined ? {} : { maxMembers: spec.max_members }),
  ...(spec.max_uncompressed_bytes === undefined ? {} : { maxUncompressedBytes: spec.max_uncompressed_bytes }),
  ...(spec.max_compression_ratio === undefined ? {} : { maxCompressionRatio: spec.max_compression_ratio }),
});

/**
 * Two streams of one source read the same member of the same artifact body;
 * decompress it once. Keyed weakly on the body so nothing outlives the run.
 */
const MEMBER_CACHE = new WeakMap<object, Map<string, Promise<ZipMember>>>();

async function unpack(body: Uint8Array, spec: ArchiveSpec): Promise<ZipMember> {
  const key = JSON.stringify([spec.member, spec.max_members, spec.max_uncompressed_bytes, spec.max_compression_ratio]);
  let perBody = MEMBER_CACHE.get(body);
  if (perBody === undefined) {
    perBody = new Map();
    MEMBER_CACHE.set(body, perBody);
  }
  let pending = perBody.get(key);
  if (pending === undefined) {
    pending = extractZipMember(body, spec.member, archiveLimits(spec));
    perBody.set(key, pending);
    pending.catch(() => perBody.delete(key));
  }
  return pending;
}

export interface UnpackedArtifact {
  readonly artifact: ExtractionArtifact;
  readonly schema: ExtractionSchema;
  /** The member read, or `null` when an unarchived body was accepted as-is. */
  readonly member: string | null;
}

/**
 * Resolves the bytes a format provider should parse.
 *
 * A body that is not a ZIP archive is refused unless the schema explicitly
 * declares `accept_unarchived` (for synthetic fixtures and for an operator who
 * supplies the already-extracted file); absence of the archive is never
 * silently tolerated.
 */
export async function unpackArchivedArtifact(
  input: ExtractionArtifact,
  schema: ExtractionSchema,
): Promise<UnpackedArtifact> {
  const { archive, ...inner } = schema;
  if (archive === undefined) return { artifact: input, schema, member: null };
  const fail = (message: string, cause?: unknown): never => {
    throw new ExtractionError(message, {
      artifactId: input.artifact.id,
      schemaId: schema.schema_id,
      ...(cause === undefined ? {} : { cause }),
    });
  };
  if (archive.format !== 'zip') fail(`unsupported archive format ${String(archive.format)}`);

  const bytes =
    typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
  if (!isZipArchive(bytes)) {
    if (archive.accept_unarchived === true) return { artifact: input, schema: inner, member: null };
    fail('ARCHIVE_EXPECTED: the schema declares a zip archive but the artifact is not one');
  }
  let member: ZipMember;
  try {
    member = await unpack(bytes, archive);
  } catch (error) {
    if (error instanceof ZipArchiveError) fail(error.message, error);
    throw error;
  }
  return { artifact: { ...input, body: member!.body }, schema: inner, member: member!.name };
}

/** Prefixes `member=<name>` onto a locator produced against the member's bytes. */
export function withArchiveMember(locator: EvidenceLocator, member: string): EvidenceLocator {
  const prefix = formatLocatorValue([['member', member]]);
  if (locator.type === 'WHOLE_DOCUMENT') return { type: 'WHOLE_DOCUMENT', value: prefix };
  if (!MEMBER_ADDRESSABLE.has(locator.type)) {
    throw new ExtractionError(`locator type ${locator.type} cannot address an archive member`);
  }
  return { type: locator.type, value: locator.value === '' ? prefix : `${prefix};${locator.value}` };
}

export function readdressRecords(records: readonly ExtractedRecord[], member: string | null): ExtractedRecord[] {
  if (member === null) return [...records];
  return records.map((record) => ({
    ...record,
    locator: withArchiveMember(record.locator, member),
    values: record.values.map((value) => ({ ...value, locator: withArchiveMember(value.locator, member) })),
    issues: record.issues.map((issue) => ({ ...issue, locator: withArchiveMember(issue.locator, member) })),
  }));
}
