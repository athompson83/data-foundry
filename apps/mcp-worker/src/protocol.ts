/** Strict, bounded request classification before the official SDK sees a body. */
export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const MAX_MCP_BODY_BYTES = 262_144;

export type McpRouteKey =
  | 'mcp.server_discover'
  | 'mcp.tools_list'
  | 'mcp.tools_call'
  | 'mcp.protocol_failure';

export type ProtocolGuardResult =
  | {
      readonly ok: true;
      readonly parsedBody: Readonly<Record<string, unknown>>;
      readonly method: string;
      readonly notification: boolean;
      readonly routeKey: McpRouteKey | null;
      readonly era: 'modern' | 'legacy';
    }
  | {
      readonly ok: false;
      readonly status: 400 | 406 | 413 | 415;
    };

function accepted(request: Request, mediaType: string): boolean {
  const header = request.headers.get('accept');
  if (header === null) return false;
  return header.split(',').some((part) => {
    const segments = part.split(';').map((segment) => segment.trim().toLowerCase());
    if (segments[0] !== mediaType) return false;
    const quality = segments.find((segment) => segment.startsWith('q='));
    if (quality === undefined) return true;
    const parsed = Number(quality.slice(2));
    return Number.isFinite(parsed) && parsed > 0;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const BASE64_SENTINEL = /^=\?base64\?((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)\?=$/;

/** Decode SEP-2243's optional Base64 sentinel without accepting loose Base64. */
function decodedHeader(value: string): string | null {
  if (!value.startsWith('=?base64?') || !value.endsWith('?=')) return value.trim();
  const match = BASE64_SENTINEL.exec(value.trim());
  if (match === null) return null;
  try {
    const binary = atob(match[1] ?? '');
    const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function boundedBytes(request: Request): Promise<Uint8Array | null> {
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^\d+$/.test(length) || Number(length) > MAX_MCP_BODY_BYTES) return null;
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_MCP_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function routeKey(method: string): McpRouteKey | null {
  if (method === 'initialize' || method === 'server/discover') return 'mcp.server_discover';
  if (method === 'tools/list') return 'mcp.tools_list';
  if (method === 'tools/call') return 'mcp.tools_call';
  if (method.startsWith('notifications/')) return null;
  return 'mcp.protocol_failure';
}

export async function guardProtocolRequest(request: Request): Promise<ProtocolGuardResult> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return { ok: false, status: 415 };
  if (!accepted(request, 'application/json') || !accepted(request, 'text/event-stream')) {
    return { ok: false, status: 406 };
  }

  const bytes = await boundedBytes(request);
  if (bytes === null) return { ok: false, status: 413 };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, status: 400 };
  }
  if (!isRecord(raw) || raw['jsonrpc'] !== '2.0' || typeof raw['method'] !== 'string') {
    return { ok: false, status: 400 };
  }
  const method = raw['method'];
  const params = raw['params'];
  const meta = isRecord(params) && isRecord(params['_meta']) ? params['_meta'] : null;
  const claimedVersion = meta?.['io.modelcontextprotocol/protocolVersion'];
  const capabilities = meta?.['io.modelcontextprotocol/clientCapabilities'];
  const protocolHeader = request.headers.get('mcp-protocol-version');
  const hasModernSignal = claimedVersion !== undefined || protocolHeader !== null;

  if (!hasModernSignal) {
    // Compatibility is intentionally bounded to the one handshake required by
    // the implementation brief. Claimless tools/list and tools/call are not a
    // second, indefinitely supported transport surface.
    if (method !== 'initialize' || !Object.hasOwn(raw, 'id')) {
      return { ok: false, status: 400 };
    }
    return {
      ok: true,
      parsedBody: raw,
      method,
      notification: false,
      routeKey: 'mcp.server_discover',
      era: 'legacy',
    };
  }

  if (
    protocolHeader !== MCP_PROTOCOL_VERSION ||
    claimedVersion !== MCP_PROTOCOL_VERSION ||
    !isRecord(capabilities) ||
    request.headers.get('mcp-method') !== method
  ) {
    return { ok: false, status: 400 };
  }
  if (method === 'tools/call') {
    const nameHeader = request.headers.get('mcp-name');
    if (
      !isRecord(params) ||
      typeof params['name'] !== 'string' ||
      nameHeader === null ||
      decodedHeader(nameHeader) !== params['name']
    ) {
      return { ok: false, status: 400 };
    }
  }

  return {
    ok: true,
    parsedBody: raw,
    method,
    notification: !Object.hasOwn(raw, 'id'),
    routeKey: routeKey(method),
    era: 'modern',
  };
}
