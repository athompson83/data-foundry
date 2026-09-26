import { describe, expect, it } from 'vitest';
import { buildZip, concat } from '../../../tests/support/zip.js';
import {
  DEFAULT_ZIP_LIMITS,
  ExtractionError,
  crc32,
  createExtractionRegistry,
  extractZipMember,
  isZipArchive,
  listZipEntries,
  parseExtractionSchema,
  parseLocatorValue,
  withArchiveMember,
  zipMemberMatcher,
  ZipArchiveError,
  type ExtractionSchema,
  type ZipErrorCode,
} from '../src/index.js';
import { CSV_BODY, CSV_SCHEMA, artifactFixture, csvArtifact } from './fixtures.js';

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

async function rejectsWith(promise: Promise<unknown> | (() => unknown), code: ZipErrorCode): Promise<void> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    expect(error).toBeInstanceOf(ZipArchiveError);
    expect((error as ZipArchiveError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('strict ZIP reader', () => {
  it('reads a stored member byte-for-byte', async () => {
    const zip = buildZip([{ name: 'vehicles.csv', data: 'a,b\n1,2\n', method: 'stored' }]);
    expect(isZipArchive(zip)).toBe(true);
    const member = await extractZipMember(zip, 'vehicles.csv');
    expect(member.name).toBe('vehicles.csv');
    expect(text(member.body)).toBe('a,b\n1,2\n');
  });

  it('inflates a deflated member and verifies its CRC-32', async () => {
    const body = Array.from({ length: 5_000 }, (_, i) => `${i},row ${i},${i * 7}`).join('\n');
    const zip = buildZip([
      { name: 'docs/readme.txt', data: 'not the data' },
      { name: 'FLAT_RCL_2026.txt', data: body },
    ]);
    expect(zip.byteLength).toBeLessThan(body.length);
    const member = await extractZipMember(zip, 'FLAT_RCL*.txt');
    expect(member.name).toBe('FLAT_RCL_2026.txt');
    expect(text(member.body)).toBe(body);
    expect(crc32(member.body)).toBe(listZipEntries(zip)[1]!.crc32);
  });

  it('matches globs within one segment unless ** is used', () => {
    expect(zipMemberMatcher('*.csv')('vehicles.csv')).toBe(true);
    expect(zipMemberMatcher('*.csv')('dir/vehicles.csv')).toBe(false);
    expect(zipMemberMatcher('**.csv')('dir/vehicles.csv')).toBe(true);
    expect(zipMemberMatcher('vehicles.csv')('vehicles_csv')).toBe(false);
    expect(zipMemberMatcher('v?hicles.csv')('vehicles.csv')).toBe(true);
  });

  it('refuses a CRC-32 mismatch', async () => {
    const zip = buildZip([{ name: 'vehicles.csv', data: 'a,b\n1,2\n', crc32: 0x12345678 }]);
    await rejectsWith(extractZipMember(zip, 'vehicles.csv'), 'ZIP_CRC_MISMATCH');
  });

  it('refuses a stored member whose bytes were altered after the CRC was written', async () => {
    const zip = buildZip([{ name: 'vehicles.csv', data: 'a,b\n1,2\n', method: 'stored' }]);
    const tampered = zip.slice();
    tampered[30 + 'vehicles.csv'.length] = 'z'.charCodeAt(0);
    await rejectsWith(extractZipMember(tampered, 'vehicles.csv'), 'ZIP_CRC_MISMATCH');
  });

  it.each(['../evil.csv', 'a/../../evil.csv', '/etc/passwd', 'C:evil.csv', 'dir\\evil.csv', './vehicles.csv', 'a\u0000b'])(
    'refuses the whole archive when any member name is unsafe (%j)',
    async (name) => {
      const zip = buildZip([{ name: 'vehicles.csv', data: 'ok' }, { name, data: 'x' }]);
      await rejectsWith(extractZipMember(zip, 'vehicles.csv'), 'ZIP_UNSAFE_MEMBER_NAME');
    },
  );

  it('refuses a zip bomb by compression ratio before inflating', async () => {
    const zeros = new Uint8Array(4 * 1024 * 1024);
    const zip = buildZip([{ name: 'vehicles.csv', data: zeros }]);
    await rejectsWith(extractZipMember(zip, 'vehicles.csv'), 'ZIP_COMPRESSION_RATIO_EXCEEDED');
    // Even the hard ceiling does not admit a ~1000x bomb.
    await rejectsWith(
      extractZipMember(zip, 'vehicles.csv', { maxCompressionRatio: 1_000 }),
      'ZIP_COMPRESSION_RATIO_EXCEEDED',
    );
  });

  it('admits a highly compressible member only under an explicit higher ratio', async () => {
    // Sparse data compressing roughly 280x: over the 200x default, under 400x.
    const sparse = new Uint8Array(400_000);
    let seed = 7;
    for (let index = 0; index < sparse.length; index += 256) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      sparse[index] = seed & 0xff;
    }
    const zip = buildZip([{ name: 'vehicles.csv', data: sparse }]);
    await rejectsWith(extractZipMember(zip, 'vehicles.csv'), 'ZIP_COMPRESSION_RATIO_EXCEEDED');
    const member = await extractZipMember(zip, 'vehicles.csv', { maxCompressionRatio: 400 });
    expect(member.body).toEqual(sparse);
  });

  it('stops a member that inflates past its declared size', async () => {
    const body = 'x'.repeat(10_000);
    const zip = buildZip([{ name: 'vehicles.csv', data: body, uncompressedSize: 100 }]);
    await rejectsWith(
      extractZipMember(zip, 'vehicles.csv', { maxCompressionRatio: 1_000 }),
      'ZIP_SIZE_MISMATCH',
    );
  });

  it('refuses a member that inflates short of its declared size', async () => {
    const zip = buildZip([{ name: 'vehicles.csv', data: 'short', uncompressedSize: 6 }]);
    await rejectsWith(extractZipMember(zip, 'vehicles.csv'), 'ZIP_SIZE_MISMATCH');
  });

  it('refuses a missing member and an ambiguous glob', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: '1' },
      { name: 'b.txt', data: '2' },
    ]);
    await rejectsWith(extractZipMember(zip, 'vehicles.csv'), 'ZIP_MEMBER_NOT_FOUND');
    await rejectsWith(extractZipMember(zip, '*.txt'), 'ZIP_MEMBER_AMBIGUOUS');
  });

  it('refuses a member over the configured uncompressed ceiling', async () => {
    const zip = buildZip([{ name: 'vehicles.csv', data: 'x'.repeat(2_048), method: 'stored' }]);
    await rejectsWith(
      extractZipMember(zip, 'vehicles.csv', { maxUncompressedBytes: 1_024 }),
      'ZIP_MEMBER_TOO_LARGE',
    );
  });

  it('refuses too many members, duplicates, encryption and unsupported methods', async () => {
    const many = buildZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' })));
    await rejectsWith(() => listZipEntries(many, { maxMembers: 4 }), 'ZIP_TOO_MANY_MEMBERS');
    const duplicate = buildZip([{ name: 'a.csv', data: '1' }, { name: 'a.csv', data: '2' }]);
    await rejectsWith(() => listZipEntries(duplicate), 'ZIP_DUPLICATE_MEMBER');
    const encrypted = buildZip([{ name: 'a.csv', data: '1', flags: 0x0001 }]);
    await rejectsWith(extractZipMember(encrypted, 'a.csv'), 'ZIP_ENCRYPTED');
    const bzip2 = buildZip([{ name: 'a.csv', data: '1', method: 12 }]);
    await rejectsWith(extractZipMember(bzip2, 'a.csv'), 'ZIP_UNSUPPORTED_METHOD');
  });

  it('refuses non-archives, truncated archives and corrupt deflate data', async () => {
    await rejectsWith(() => listZipEntries(new TextEncoder().encode('a,b\n1,2\n'.repeat(10))), 'ZIP_NOT_AN_ARCHIVE');
    const zip = buildZip([{ name: 'vehicles.csv', data: 'a,b\n1,2\n'.repeat(100) }]);
    await rejectsWith(() => listZipEntries(zip.subarray(0, zip.byteLength - 5)), 'ZIP_NOT_AN_ARCHIVE');
    const corrupt = zip.slice();
    // Overwrite the start of the deflate stream with an invalid block type.
    corrupt[30 + 'vehicles.csv'.length] = 0xff;
    corrupt[31 + 'vehicles.csv'.length] = 0xff;
    await expect(extractZipMember(corrupt, 'vehicles.csv')).rejects.toBeInstanceOf(ZipArchiveError);
  });

  it('refuses an end record followed by bytes it does not declare', async () => {
    const zip = concat([buildZip([{ name: 'a.csv', data: '1' }]), new TextEncoder().encode('trailing')]);
    await rejectsWith(() => listZipEntries(zip), 'ZIP_NOT_AN_ARCHIVE');
  });

  it('reads ZIP64 extended sizes from the central directory', async () => {
    const zip = buildZip([{ name: 'vehicles.csv', data: 'a,b\n1,2\n', zip64: true }]);
    const [entry] = listZipEntries(zip);
    expect(entry!.uncompressedSize).toBe(8);
    expect(text((await extractZipMember(zip, 'vehicles.csv')).body)).toBe('a,b\n1,2\n');
  });

  it('refuses limits that are not positive or exceed the hard ceilings', async () => {
    const zip = buildZip([{ name: 'a.csv', data: '1' }]);
    await rejectsWith(() => listZipEntries(zip, { maxMembers: 0 }), 'ZIP_INVALID_LIMITS');
    await rejectsWith(() => listZipEntries(zip, { maxUncompressedBytes: 2 ** 40 }), 'ZIP_INVALID_LIMITS');
    expect(DEFAULT_ZIP_LIMITS.maxCompressionRatio).toBeLessThanOrEqual(1_000);
  });
});

describe('archive-aware extraction', () => {
  const archived = (archive: Record<string, unknown>): ExtractionSchema =>
    parseExtractionSchema({ ...CSV_SCHEMA, archive });

  const zipArtifact = (bytes: Uint8Array) =>
    artifactFixture({
      id: '44444444-4444-4444-8444-444444444444',
      mime_type: 'application/zip',
      url: 'https://acme-hvac.example/downloads/models.csv.zip',
      body: bytes,
      acquisition_route: 'BULK_FILE',
    });

  it('extracts the named member and cites member, row and column', async () => {
    const zip = buildZip([{ name: 'models.csv', data: CSV_BODY }]);
    const registry = createExtractionRegistry();
    const plain = await registry.extract(csvArtifact(), CSV_SCHEMA);
    const records = await registry.extract(zipArtifact(zip), archived({ format: 'zip', member: 'models.csv' }));

    expect(records.map((record) => record.source_record_key)).toEqual(plain.map((record) => record.source_record_key));
    expect(records.map((record) => record.raw_payload)).toEqual(plain.map((record) => record.raw_payload));
    // The archive, not the member, is the artifact the records cite.
    expect(new Set(records.map((record) => record.artifact_id))).toEqual(new Set([zipArtifact(zip).artifact.id]));
    const value = records[0]!.values.find((candidate) => candidate.field === 'model_number')!;
    expect(value.locator.type).toBe('TABLE_CELL');
    expect(parseLocatorValue(value.locator.value)).toEqual({ member: 'models.csv', row: '2', column: 'Model', index: '0' });
    expect(records[0]!.locator.value).toBe('member=models.csv;start=2;end=2');
    for (const issue of records.flatMap((record) => record.issues)) {
      expect(issue.locator.value.startsWith('member=models.csv;')).toBe(true);
    }
  });

  it('skips a declared preamble inside the member, not the archive', async () => {
    const zip = buildZip([{ name: 'models.csv', data: `# banner\n# banner 2\n${CSV_BODY}` }]);
    const schema = archived({ format: 'zip', member: 'models.csv' });
    const records = await createExtractionRegistry().extract(zipArtifact(zip), {
      ...schema,
      record: { kind: 'csv_rows', header: true, skip_empty_lines: true, skip_leading_lines_matching: '^#' },
    });
    expect(records).toHaveLength(3);
    const value = records[0]!.values.find((candidate) => candidate.field === 'model_number')!;
    expect(parseLocatorValue(value.locator.value)['row']).toBe('4');
  });

  it('refuses an unarchived body unless the schema accepts one', async () => {
    const registry = createExtractionRegistry();
    await expect(registry.extract(csvArtifact(), archived({ format: 'zip', member: 'models.csv' }))).rejects.toThrow(
      /ARCHIVE_EXPECTED/,
    );
    const records = await registry.extract(
      csvArtifact(),
      archived({ format: 'zip', member: 'models.csv', accept_unarchived: true }),
    );
    expect(records[0]!.values[0]!.locator.value.startsWith('row=')).toBe(true);
  });

  it('surfaces archive refusals as extraction errors with the ZIP code', async () => {
    const zip = buildZip([{ name: 'other.csv', data: CSV_BODY }]);
    const error = await createExtractionRegistry()
      .extract(zipArtifact(zip), archived({ format: 'zip', member: 'models.csv' }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as Error).message).toMatch(/ZIP_MEMBER_NOT_FOUND/);
  });

  it('applies the schema-declared limits', async () => {
    const zip = buildZip([{ name: 'models.csv', data: CSV_BODY }]);
    await expect(
      createExtractionRegistry().extract(
        zipArtifact(zip),
        archived({ format: 'zip', member: 'models.csv', max_uncompressed_bytes: 16 }),
      ),
    ).rejects.toThrow(/ZIP_MEMBER_TOO_LARGE/);
  });

  it('validates archive declarations', () => {
    expect(() => archived({ format: 'tar', member: 'x' })).toThrow(/format/);
    expect(() => archived({ format: 'zip', member: '../x.csv' })).toThrow(/member/);
    expect(() => archived({ format: 'zip', member: 'x.csv', max_compression_ratio: 5_000 })).toThrow(/max_compression_ratio/);
    expect(() => archived({ format: 'zip', member: 'x.csv', surprise: true })).toThrow(/unknown archive option/);
    expect(() =>
      parseExtractionSchema({
        schema_id: 'json',
        format: 'json',
        entity_type: 'thing',
        record: { kind: 'whole_document' },
        record_key: { fields: ['a'] },
        fields: [{ field: 'a', locate: { kind: 'json_pointer', pointer: '/a' } }],
        archive: { format: 'zip', member: 'x.json' },
      }),
    ).toThrow(/not supported for format json/);
  });

  it('refuses to re-address a locator type without key=value grammar', () => {
    expect(() => withArchiveMember({ type: 'JSON_POINTER', value: '/a' }, 'x.json')).toThrow(ExtractionError);
    expect(withArchiveMember({ type: 'WHOLE_DOCUMENT', value: '' }, 'x.csv')).toEqual({
      type: 'WHOLE_DOCUMENT',
      value: 'member=x.csv',
    });
  });
});
