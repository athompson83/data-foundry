/**
 * Test-only ZIP writer. Builds archives in-test with `node:zlib` so the reader
 * is exercised against real deflate streams, plus deliberate defects (wrong
 * CRC, lying sizes, unsafe names, ZIP64 records) that no honest tool emits.
 */
import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';

export interface TestZipEntry {
  readonly name: string;
  readonly data: string | Uint8Array;
  readonly method?: 'stored' | 'deflate' | number;
  readonly flags?: number;
  readonly crc32?: number;
  readonly uncompressedSize?: number;
  /** Emit this entry with ZIP64 sentinels and an extended-information extra field. */
  readonly zip64?: boolean;
}

const bytesOf = (data: string | Uint8Array): Uint8Array =>
  typeof data === 'string' ? new TextEncoder().encode(data) : data;

export function buildZip(entries: readonly TestZipEntry[], options: { comment?: string } = {}): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = bytesOf(entry.data);
    const method = entry.method === undefined || entry.method === 'deflate' ? 8 : entry.method === 'stored' ? 0 : entry.method;
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = entry.crc32 ?? zlibCrc32(raw);
    const size = entry.uncompressedSize ?? raw.byteLength;
    const name = new TextEncoder().encode(entry.name);
    const flags = (entry.flags ?? 0) | 0x0800;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compressed.byteLength, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.byteLength, true);
    const localBytes = concat([new Uint8Array(local.buffer), name, compressed]);

    const extra = entry.zip64 === true ? zip64Extra(size, compressed.byteLength, offset) : new Uint8Array();
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 45, true);
    central.setUint16(6, 45, true);
    central.setUint16(8, flags, true);
    central.setUint16(10, method, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, entry.zip64 === true ? 0xffffffff : compressed.byteLength, true);
    central.setUint32(24, entry.zip64 === true ? 0xffffffff : size, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint16(30, extra.byteLength, true);
    central.setUint32(42, entry.zip64 === true ? 0xffffffff : offset, true);
    centrals.push(concat([new Uint8Array(central.buffer), name, extra]));

    locals.push(localBytes);
    offset += localBytes.byteLength;
  }
  const directory = concat(centrals);
  const comment = new TextEncoder().encode(options.comment ?? '');
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, directory.byteLength, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, comment.byteLength, true);
  return concat([...locals, directory, new Uint8Array(eocd.buffer), comment]);
}

function zip64Extra(uncompressed: number, compressed: number, offset: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(4 + 24));
  view.setUint16(0, 0x0001, true);
  view.setUint16(2, 24, true);
  view.setBigUint64(4, BigInt(uncompressed), true);
  view.setBigUint64(12, BigInt(compressed), true);
  view.setBigUint64(20, BigInt(offset), true);
  return new Uint8Array(view.buffer);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
