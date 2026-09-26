/**
 * A minimal, strict, read-only ZIP reader.
 *
 * Why this exists: the publishers of several bulk datasets ship one delimited
 * file inside a ZIP archive, and the archive — not the file inside it — is the
 * artifact acquisition preserves (AGENTS.md rule 10). Extraction therefore has
 * to be able to read one named member out of the preserved bytes, in Node and in
 * a Cloudflare Worker, without a filesystem and without a new dependency.
 *
 * Deliberately small. It reads the central directory, supports only the two
 * methods real bulk files use (0 = stored, 8 = deflate), and refuses everything
 * else rather than guessing: encryption, multi-disk archives, unsafe or
 * duplicate member names, a member count, declared size or compression ratio
 * over the configured ceiling, a member whose inflated bytes overrun its
 * declared size, and a CRC-32 mismatch. Every refusal is a `ZipArchiveError`
 * with a stable `code`, and every limit fails closed.
 *
 * Decompression uses the web-standard `DecompressionStream('deflate-raw')`,
 * available in Node 22 and in Workers, and is streamed into a buffer sized from
 * the central directory, so an archive that lies about its sizes is stopped at
 * the first byte over the declared length rather than after it has exhausted
 * memory.
 */

export const ZIP_ERROR_CODES = [
  'ZIP_NOT_AN_ARCHIVE',
  'ZIP_TRUNCATED',
  'ZIP_MULTI_DISK_UNSUPPORTED',
  'ZIP_TOO_MANY_MEMBERS',
  'ZIP_UNSAFE_MEMBER_NAME',
  'ZIP_DUPLICATE_MEMBER',
  'ZIP_ENCRYPTED',
  'ZIP_UNSUPPORTED_METHOD',
  'ZIP_MEMBER_NOT_FOUND',
  'ZIP_MEMBER_AMBIGUOUS',
  'ZIP_MEMBER_TOO_LARGE',
  'ZIP_COMPRESSION_RATIO_EXCEEDED',
  'ZIP_SIZE_MISMATCH',
  'ZIP_CRC_MISMATCH',
  'ZIP_CORRUPT',
  'ZIP_INVALID_LIMITS',
] as const;
export type ZipErrorCode = (typeof ZIP_ERROR_CODES)[number];

export class ZipArchiveError extends Error {
  readonly code: ZipErrorCode;

  constructor(code: ZipErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(`${code}: ${message}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ZipArchiveError';
    this.code = code;
  }
}

export interface ZipLimits {
  /** Central-directory entries (files and directories) allowed in one archive. */
  readonly maxMembers: number;
  /** Largest uncompressed member that may be read. */
  readonly maxUncompressedBytes: number;
  /** Largest uncompressed/compressed ratio allowed for a deflated member. */
  readonly maxCompressionRatio: number;
}

/**
 * Defaults sized for single-member government bulk files: a delimited text file
 * compresses roughly 5-20x, so 200x is generous for honest data and still stops
 * the classic zip bomb (1000x+). The 512 MiB ceiling keeps the member inside one
 * JavaScript string when it is decoded for parsing.
 */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxMembers: 64,
  maxUncompressedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 200,
};

/** Hard ceilings a declared limit may not exceed. */
export const ZIP_LIMIT_CEILINGS: ZipLimits = {
  maxMembers: 10_000,
  maxUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 1_000,
};

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly isDirectory: boolean;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export function resolveZipLimits(overrides: Partial<ZipLimits> = {}): ZipLimits {
  const limits = { ...DEFAULT_ZIP_LIMITS, ...definedOnly(overrides) };
  for (const key of Object.keys(ZIP_LIMIT_CEILINGS) as (keyof ZipLimits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > ZIP_LIMIT_CEILINGS[key]) {
      throw new ZipArchiveError(
        'ZIP_INVALID_LIMITS',
        `${key} must be a positive integer no greater than ${ZIP_LIMIT_CEILINGS[key]}`,
      );
    }
  }
  return limits;
}

function definedOnly(input: Partial<ZipLimits>): Partial<ZipLimits> {
  const out: Partial<Record<keyof ZipLimits, number>> = {};
  for (const [key, value] of Object.entries(input) as [keyof ZipLimits, number | undefined][]) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** True when the bytes begin like a ZIP archive (a local header, or an empty archive). */
export function isZipArchive(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const signature = view(bytes).getUint32(0, true);
  return signature === SIG_LOCAL || (signature === SIG_EOCD && bytes.byteLength >= EOCD_SIZE);
}

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

interface EndOfCentralDirectory {
  readonly entries: number;
  readonly directorySize: number;
  readonly directoryOffset: number;
  /** Where the (ZIP64 or classic) end records begin; the directory must end at or before it. */
  readonly endRecordsOffset: number;
}

function readEndOfCentralDirectory(bytes: Uint8Array): EndOfCentralDirectory {
  if (bytes.byteLength < EOCD_SIZE) {
    throw new ZipArchiveError('ZIP_NOT_AN_ARCHIVE', 'too short to contain an end-of-central-directory record');
  }
  const data = view(bytes);
  const lowest = Math.max(0, bytes.byteLength - EOCD_SIZE - MAX_COMMENT);
  let offset = -1;
  for (let candidate = bytes.byteLength - EOCD_SIZE; candidate >= lowest; candidate -= 1) {
    // The record must be exactly followed by its declared comment and nothing else.
    if (
      data.getUint32(candidate, true) === SIG_EOCD &&
      candidate + EOCD_SIZE + data.getUint16(candidate + 20, true) === bytes.byteLength
    ) {
      offset = candidate;
      break;
    }
  }
  if (offset < 0) {
    throw new ZipArchiveError('ZIP_NOT_AN_ARCHIVE', 'no end-of-central-directory record');
  }

  const disk = data.getUint16(offset + 4, true);
  const directoryDisk = data.getUint16(offset + 6, true);
  const entriesOnDisk = data.getUint16(offset + 8, true);
  let entries = data.getUint16(offset + 10, true);
  let directorySize = data.getUint32(offset + 12, true);
  let directoryOffset = data.getUint32(offset + 16, true);
  let endRecordsOffset = offset;

  const zip64 =
    entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff ||
    entriesOnDisk === 0xffff || disk === 0xffff || directoryDisk === 0xffff;
  if (zip64) {
    const locator = offset - 20;
    if (locator < 0 || data.getUint32(locator, true) !== SIG_EOCD64_LOCATOR) {
      throw new ZipArchiveError('ZIP_CORRUPT', 'ZIP64 values without a ZIP64 end-of-central-directory locator');
    }
    if (data.getUint32(locator + 4, true) !== 0 || data.getUint32(locator + 16, true) !== 1) {
      throw new ZipArchiveError('ZIP_MULTI_DISK_UNSUPPORTED', 'multi-disk ZIP64 archives are not supported');
    }
    const record = safeUint64(data, locator + 8, 'ZIP64 end record offset');
    if (record + 56 > locator || data.getUint32(record, true) !== SIG_EOCD64) {
      throw new ZipArchiveError('ZIP_CORRUPT', 'ZIP64 end-of-central-directory record is missing or misplaced');
    }
    if (data.getUint32(record + 16, true) !== 0 || data.getUint32(record + 20, true) !== 0) {
      throw new ZipArchiveError('ZIP_MULTI_DISK_UNSUPPORTED', 'multi-disk ZIP64 archives are not supported');
    }
    const onDisk64 = safeUint64(data, record + 24, 'ZIP64 entries on disk');
    entries = safeUint64(data, record + 32, 'ZIP64 entry count');
    if (onDisk64 !== entries) {
      throw new ZipArchiveError('ZIP_MULTI_DISK_UNSUPPORTED', 'entry counts disagree between disks');
    }
    directorySize = safeUint64(data, record + 40, 'ZIP64 directory size');
    directoryOffset = safeUint64(data, record + 48, 'ZIP64 directory offset');
    endRecordsOffset = record;
  } else if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entries) {
    throw new ZipArchiveError('ZIP_MULTI_DISK_UNSUPPORTED', 'multi-disk archives are not supported');
  }

  if (directoryOffset + directorySize > endRecordsOffset) {
    throw new ZipArchiveError('ZIP_TRUNCATED', 'central directory extends past the end records');
  }
  return { entries, directorySize, directoryOffset, endRecordsOffset };
}

function safeUint64(data: DataView, offset: number, label: string): number {
  if (offset < 0 || offset + 8 > data.byteLength) {
    throw new ZipArchiveError('ZIP_TRUNCATED', `${label} is out of bounds`);
  }
  const value = data.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipArchiveError('ZIP_CORRUPT', `${label} is not a safe integer`);
  }
  return Number(value);
}

/**
 * Member names are addresses in evidence locators and are never written to a
 * filesystem here; they are still validated as if they were, because an archive
 * carrying a traversal name is not one a publisher produced honestly.
 */
export function assertSafeMemberName(name: string): void {
  const unsafe =
    name.length === 0 ||
    name.length > 1024 ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(name) ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').some((segment) => segment === '..' || segment === '.');
  if (unsafe) {
    throw new ZipArchiveError('ZIP_UNSAFE_MEMBER_NAME', `unsafe member name ${JSON.stringify(name)}`);
  }
}

function decodeName(raw: Uint8Array, utf8: boolean): string {
  if (utf8 || raw.every((byte) => byte < 0x80)) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch (error) {
      throw new ZipArchiveError('ZIP_UNSAFE_MEMBER_NAME', 'member name is not valid UTF-8', { cause: error });
    }
  }
  // Legacy (CP437) names: keep them addressable without pretending to decode them.
  return Array.from(raw, (byte) => String.fromCharCode(byte)).join('');
}

/** Reads and validates the central directory. Does not decompress anything. */
export function listZipEntries(bytes: Uint8Array, overrides: Partial<ZipLimits> = {}): ZipEntry[] {
  const limits = resolveZipLimits(overrides);
  const eocd = readEndOfCentralDirectory(bytes);
  if (eocd.entries > limits.maxMembers) {
    throw new ZipArchiveError(
      'ZIP_TOO_MANY_MEMBERS',
      `archive declares ${eocd.entries} members; the limit is ${limits.maxMembers}`,
    );
  }

  const data = view(bytes);
  const end = eocd.directoryOffset + eocd.directorySize;
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let cursor = eocd.directoryOffset;
  for (let index = 0; index < eocd.entries; index += 1) {
    if (cursor + 46 > end || data.getUint32(cursor, true) !== SIG_CENTRAL) {
      throw new ZipArchiveError('ZIP_CORRUPT', `central directory entry ${index} is malformed`);
    }
    const flags = data.getUint16(cursor + 8, true);
    const method = data.getUint16(cursor + 10, true);
    const crc32 = data.getUint32(cursor + 16, true);
    let compressedSize = data.getUint32(cursor + 20, true);
    let uncompressedSize = data.getUint32(cursor + 24, true);
    const nameLength = data.getUint16(cursor + 28, true);
    const extraLength = data.getUint16(cursor + 30, true);
    const commentLength = data.getUint16(cursor + 32, true);
    const diskStart = data.getUint16(cursor + 34, true);
    let localHeaderOffset = data.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > end) throw new ZipArchiveError('ZIP_CORRUPT', `central directory entry ${index} overruns the directory`);

    // ZIP64 extended information: present fields appear in this fixed order,
    // only for the header fields that hold the 0xFFFFFFFF sentinel.
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      let extra = extraStart;
      let found = false;
      while (extra + 4 <= extraStart + extraLength) {
        const id = data.getUint16(extra, true);
        const size = data.getUint16(extra + 2, true);
        if (extra + 4 + size > extraStart + extraLength) break;
        if (id === 0x0001) {
          let field = extra + 4;
          const fieldEnd = field + size;
          const take = (label: string): number => {
            if (field + 8 > fieldEnd) throw new ZipArchiveError('ZIP_CORRUPT', `ZIP64 extra field lacks ${label}`);
            const value = safeUint64(data, field, label);
            field += 8;
            return value;
          };
          if (uncompressedSize === 0xffffffff) uncompressedSize = take('uncompressed size');
          if (compressedSize === 0xffffffff) compressedSize = take('compressed size');
          if (localHeaderOffset === 0xffffffff) localHeaderOffset = take('local header offset');
          found = true;
          break;
        }
        extra += 4 + size;
      }
      if (!found) throw new ZipArchiveError('ZIP_CORRUPT', `entry ${index} uses ZIP64 sentinels without a ZIP64 extra field`);
    }
    if (diskStart !== 0 && diskStart !== 0xffff) {
      throw new ZipArchiveError('ZIP_MULTI_DISK_UNSUPPORTED', `entry ${index} starts on disk ${diskStart}`);
    }

    const name = decodeName(bytes.subarray(nameStart, extraStart), (flags & 0x0800) !== 0);
    assertSafeMemberName(name);
    if (names.has(name)) throw new ZipArchiveError('ZIP_DUPLICATE_MEMBER', `member ${JSON.stringify(name)} appears twice`);
    names.add(name);
    if (localHeaderOffset >= eocd.directoryOffset) {
      throw new ZipArchiveError('ZIP_CORRUPT', `member ${JSON.stringify(name)} points into the central directory`);
    }

    entries.push({
      name,
      method,
      flags,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });
    cursor = next;
  }
  return entries;
}

/**
 * `*` matches within one path segment, `**` across segments, `?` one
 * character; anything else is literal. A selector with no wildcard is an exact
 * name.
 */
export function zipMemberMatcher(selector: string): (name: string) => boolean {
  if (!/[*?]/.test(selector)) return (name) => name === selector;
  let pattern = '^';
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]!;
    if (char === '*' && selector[index + 1] === '*') {
      pattern += '.*';
      index += 1;
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const regex = new RegExp(`${pattern}$`);
  return (name) => regex.test(name);
}

/** Exactly one non-directory member must match; zero or several is a refusal. */
export function selectZipMember(entries: readonly ZipEntry[], selector: string): ZipEntry {
  const matches = zipMemberMatcher(selector);
  const found = entries.filter((entry) => !entry.isDirectory && matches(entry.name));
  if (found.length === 0) {
    throw new ZipArchiveError(
      'ZIP_MEMBER_NOT_FOUND',
      `no member matches ${JSON.stringify(selector)} (members: ${entries.map((entry) => entry.name).join(', ') || 'none'})`,
    );
  }
  if (found.length > 1) {
    throw new ZipArchiveError(
      'ZIP_MEMBER_AMBIGUOUS',
      `${found.length} members match ${JSON.stringify(selector)}: ${found.map((entry) => entry.name).join(', ')}`,
    );
  }
  return found[0]!;
}

/** Decompresses one member, enforcing size, ratio, declared-length and CRC-32. */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  overrides: Partial<ZipLimits> = {},
): Promise<Uint8Array> {
  const limits = resolveZipLimits(overrides);
  if ((entry.flags & 0x0001) !== 0) {
    throw new ZipArchiveError('ZIP_ENCRYPTED', `member ${JSON.stringify(entry.name)} is encrypted`);
  }
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
    throw new ZipArchiveError(
      'ZIP_UNSUPPORTED_METHOD',
      `member ${JSON.stringify(entry.name)} uses compression method ${entry.method}; only stored and deflate are supported`,
    );
  }
  if (entry.uncompressedSize > limits.maxUncompressedBytes) {
    throw new ZipArchiveError(
      'ZIP_MEMBER_TOO_LARGE',
      `member ${JSON.stringify(entry.name)} declares ${entry.uncompressedSize} bytes; the limit is ${limits.maxUncompressedBytes}`,
    );
  }
  if (entry.method === METHOD_STORED && entry.compressedSize !== entry.uncompressedSize) {
    throw new ZipArchiveError('ZIP_SIZE_MISMATCH', `stored member ${JSON.stringify(entry.name)} declares different sizes`);
  }
  if (
    entry.method === METHOD_DEFLATE &&
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio)
  ) {
    throw new ZipArchiveError(
      'ZIP_COMPRESSION_RATIO_EXCEEDED',
      `member ${JSON.stringify(entry.name)} expands ${entry.compressedSize} -> ${entry.uncompressedSize} bytes, ` +
        `over the ${limits.maxCompressionRatio}x ratio limit`,
    );
  }

  const data = view(bytes);
  const local = entry.localHeaderOffset;
  if (local + 30 > bytes.byteLength || data.getUint32(local, true) !== SIG_LOCAL) {
    throw new ZipArchiveError('ZIP_CORRUPT', `member ${JSON.stringify(entry.name)} has no local file header`);
  }
  const localNameLength = data.getUint16(local + 26, true);
  const localExtraLength = data.getUint16(local + 28, true);
  const localName = bytes.subarray(local + 30, local + 30 + localNameLength);
  const start = local + 30 + localNameLength + localExtraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength || localName.byteLength !== localNameLength) {
    throw new ZipArchiveError('ZIP_TRUNCATED', `member ${JSON.stringify(entry.name)} data is out of bounds`);
  }
  if (decodeName(localName, (data.getUint16(local + 6, true) & 0x0800) !== 0) !== entry.name) {
    throw new ZipArchiveError('ZIP_CORRUPT', `member ${JSON.stringify(entry.name)} local and central names differ`);
  }

  const compressed = bytes.subarray(start, end);
  const output =
    entry.method === METHOD_STORED ? compressed.slice() : await inflateBounded(compressed, entry);
  if (output.byteLength !== entry.uncompressedSize) {
    throw new ZipArchiveError(
      'ZIP_SIZE_MISMATCH',
      `member ${JSON.stringify(entry.name)} inflated to ${output.byteLength} bytes, declared ${entry.uncompressedSize}`,
    );
  }
  const actual = crc32(output);
  if (actual !== entry.crc32) {
    throw new ZipArchiveError(
      'ZIP_CRC_MISMATCH',
      `member ${JSON.stringify(entry.name)} CRC-32 ${hex(actual)} does not match declared ${hex(entry.crc32)}`,
    );
  }
  return output;
}

async function inflateBounded(compressed: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const output = new Uint8Array(entry.uncompressedSize);
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // Written concurrently with reading so back-pressure cannot deadlock; its
  // failure surfaces through the reader.
  const written = writer
    .write(compressed as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
    .catch(() => undefined);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > output.byteLength - length) {
        throw new ZipArchiveError(
          'ZIP_SIZE_MISMATCH',
          `member ${JSON.stringify(entry.name)} inflates past its declared ${entry.uncompressedSize} bytes`,
        );
      }
      output.set(value, length);
      length += value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await writer.abort().catch(() => undefined);
    if (error instanceof ZipArchiveError) throw error;
    throw new ZipArchiveError('ZIP_CORRUPT', `member ${JSON.stringify(entry.name)} is not valid deflate data`, {
      cause: error,
    });
  }
  await written;
  return length === output.byteLength ? output : output.subarray(0, length);
}

export interface ZipMember {
  readonly name: string;
  readonly body: Uint8Array;
}

/** List, select exactly one member by name or glob, and read it under the limits. */
export async function extractZipMember(
  bytes: Uint8Array,
  selector: string,
  overrides: Partial<ZipLimits> = {},
): Promise<ZipMember> {
  const entry = selectZipMember(listZipEntries(bytes, overrides), selector);
  return { name: entry.name, body: await readZipEntry(bytes, entry, overrides) };
}

const hex = (value: number): string => value.toString(16).padStart(8, '0');

let CRC_TABLE: Uint32Array | null = null;

/** IEEE CRC-32, as ZIP declares it. */
export function crc32(bytes: Uint8Array): number {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  const table = CRC_TABLE;
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
