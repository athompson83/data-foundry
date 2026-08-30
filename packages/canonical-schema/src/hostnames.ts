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

/** Normalize case, brackets, and DNS root-dot spelling before policy checks. */
export function canonicalizeEndpointHostname(value: string): string {
  return normalizeHostname(value);
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

function isIpLiteral(value: string): boolean {
  if (parseIpv4(value) !== null || parseIpv6(value) !== null) return true;
  try {
    // URL also recognizes the legacy IPv4 literal spellings (for example
    // 127.1 and 0x7f000001) that a Worker request URL would normalize to an
    // address even though they do not look like a four-octet literal.
    const parsed = normalizeHostname(new URL(`https://${value}`).hostname);
    return parseIpv4(parsed) !== null || parseIpv6(parsed) !== null;
  } catch {
    return false;
  }
}

function isValidLdhHostname(value: string): boolean {
  if (value.length > 253) return false;
  const labels = value.split('.');
  const finalLabel = labels.at(-1) ?? '';
  return (
    labels.length >= 2 &&
    /[a-z]/.test(finalLabel) &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  );
}

function isDomainOrSubdomain(value: string, suffix: string): boolean {
  return value === suffix || value.endsWith(`.${suffix}`);
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

/**
 * Production marketplace/origin hostnames must be public DNS names, not IP
 * literals, special-use/documentation names, or provider fallback zones.
 */
export function isUnsafeCanonicalProductionHostname(value: string): boolean {
  const hostname = normalizeHostname(value);
  return (
    hostname === '' ||
    !hostname.includes('.') ||
    hostname.includes('*') ||
    !isValidLdhHostname(hostname) ||
    isIpLiteral(hostname) ||
    isUnsafeProductionEndpointHostname(hostname) ||
    isDomainOrSubdomain(hostname, 'invalid') ||
    isDomainOrSubdomain(hostname, 'example') ||
    isDomainOrSubdomain(hostname, 'test') ||
    isDomainOrSubdomain(hostname, 'example.com') ||
    isDomainOrSubdomain(hostname, 'example.net') ||
    isDomainOrSubdomain(hostname, 'example.org') ||
    isDomainOrSubdomain(hostname, 'alt') ||
    isDomainOrSubdomain(hostname, 'local') ||
    isDomainOrSubdomain(hostname, 'onion') ||
    isDomainOrSubdomain(hostname, 'home.arpa') ||
    isDomainOrSubdomain(hostname, 'arpa') ||
    isDomainOrSubdomain(hostname, 'workers.dev') ||
    isDomainOrSubdomain(hostname, 'pages.dev') ||
    isDomainOrSubdomain(hostname, 'trycloudflare.com')
  );
}

export interface CanonicalProductionWorkerRoute {
  readonly hostname: string;
  readonly pattern: string;
}

/**
 * Parse the one production Worker route shape supported by Data Foundry.
 * Cloudflare accepts broader route syntax, but deployable manifests use an
 * exact lowercase public DNS host followed by the full-host wildcard `/*`.
 */
export function parseCanonicalProductionWorkerRoute(
  value: string,
): CanonicalProductionWorkerRoute | null {
  if (value !== value.trim() || !value.endsWith('/*')) return null;
  const hostname = value.slice(0, -2);
  if (
    hostname === '' ||
    hostname !== hostname.toLowerCase() ||
    hostname !== canonicalizeEndpointHostname(hostname) ||
    isUnsafeCanonicalProductionHostname(hostname)
  ) {
    return null;
  }
  return { hostname, pattern: value };
}
