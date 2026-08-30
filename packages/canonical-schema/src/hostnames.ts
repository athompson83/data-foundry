/**
 * Canonical endpoint-host classification shared by every production composition
 * root and its deployment validator. URL implementations normalize equivalent
 * IP spellings differently, so security decisions must not depend on a caller
 * comparing the original string to one preferred rendering.
 */
export type EndpointHostnameKind = 'public' | 'loopback' | 'unspecified';

function normalizeHostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.+$/, '');
}

function parseIpv4(value: string): readonly number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const parsed = Number(part);
    return parsed >= 0 && parsed <= 255 ? parsed : null;
  });
  return octets.some((octet) => octet === null) ? null : (octets as number[]);
}

function parseIpv6(value: string): readonly number[] | null {
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (half === '') return [];
    const parts = half.split(':');
    const words: number[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part === undefined || part === '') return null;
      if (part.includes('.')) {
        // IPv4 notation is legal only in the final IPv6 component.
        if (index !== parts.length - 1) return null;
        const octets = parseIpv4(part);
        if (octets === null) return null;
        words.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      words.push(Number.parseInt(part, 16));
    }
    return words;
  };
  const left = parseHalf(halves[0] ?? '');
  const right = parseHalf(halves[1] ?? '');
  if (left === null || right === null) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array<number>(missing).fill(0), ...right] : null;
}

function classifyIpv4(octets: readonly number[]): EndpointHostnameKind {
  if (octets[0] === 127) return 'loopback';
  if (octets.every((octet) => octet === 0)) return 'unspecified';
  return 'public';
}

/** Classify loopback and unspecified endpoint spellings after canonical parsing. */
export function classifyEndpointHostname(value: string): EndpointHostnameKind {
  const hostname = normalizeHostname(value);
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return 'loopback';

  const ipv4 = parseIpv4(hostname);
  if (ipv4 !== null) return classifyIpv4(ipv4);

  const ipv6 = parseIpv6(hostname);
  if (ipv6 === null) return 'public';
  if (ipv6.every((word) => word === 0)) return 'unspecified';
  if (ipv6.slice(0, 7).every((word) => word === 0) && ipv6[7] === 1) return 'loopback';

  // IPv4-compatible and IPv4-mapped IPv6 literals must receive the same
  // local-address policy as their embedded IPv4 address.
  const ipv4Mapped = ipv6.slice(0, 5).every((word) => word === 0) &&
    (ipv6[5] === 0 || ipv6[5] === 0xffff);
  if (ipv4Mapped) {
    return classifyIpv4([
      (ipv6[6]! >> 8) & 0xff,
      ipv6[6]! & 0xff,
      (ipv6[7]! >> 8) & 0xff,
      ipv6[7]! & 0xff,
    ]);
  }
  return 'public';
}

/** Development may use HTTP only for loopback; unspecified binds do not qualify. */
export function isLoopbackEndpointHostname(value: string): boolean {
  return classifyEndpointHostname(value) === 'loopback';
}

/** Production endpoints must not name a loopback or unspecified bind address. */
export function isUnsafeProductionEndpointHostname(value: string): boolean {
  return classifyEndpointHostname(value) !== 'public';
}
