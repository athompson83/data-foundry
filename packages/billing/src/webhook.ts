/**
 * Stripe webhook signature verification (the `Stripe-Signature` scheme).
 *
 * The header is `t=<unix seconds>,v1=<hex hmac>[,v1=...][,v0=...]`. The signed
 * payload is `${t}.${rawBody}`, HMAC-SHA256 keyed by the endpoint's signing
 * secret. Any matching `v1` passes (Stripe sends several during secret
 * rotation); `v0` is a test-mode legacy scheme and is ignored. The timestamp
 * must fall inside the tolerance window, so a captured delivery cannot be
 * replayed later.
 */

export type WebhookVerificationFailure =
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'TIMESTAMP_OUT_OF_TOLERANCE'
  | 'SIGNATURE_MISMATCH';

export type WebhookVerification =
  | { readonly ok: true; readonly timestamp: number }
  | { readonly ok: false; readonly reason: WebhookVerificationFailure };

export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compares two equal-length lowercase hex strings without an early exit. */
function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function computeStripeSignature(
  secret: string,
  timestamp: number,
  payload: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  return toHex(mac);
}

export async function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  nowSeconds: number,
  toleranceSeconds: number = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
): Promise<WebhookVerification> {
  if (header === null || header === undefined || header.trim() === '') {
    return { ok: false, reason: 'MISSING_SIGNATURE' };
  }
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return { ok: false, reason: 'MALFORMED_SIGNATURE' };
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === 't') {
      if (!/^\d{1,12}$/.test(value) || timestamp !== null) {
        return { ok: false, reason: 'MALFORMED_SIGNATURE' };
      }
      timestamp = Number(value);
    } else if (name === 'v1') {
      if (!HEX_SIGNATURE.test(value)) return { ok: false, reason: 'MALFORMED_SIGNATURE' };
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) {
    return { ok: false, reason: 'MALFORMED_SIGNATURE' };
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' };
  }
  const expected = await computeStripeSignature(secret, timestamp, payload);
  let matched = false;
  for (const candidate of signatures) {
    // Visit every candidate so the loop's duration does not reveal which matched.
    if (constantTimeHexEqual(candidate, expected)) matched = true;
  }
  return matched ? { ok: true, timestamp } : { ok: false, reason: 'SIGNATURE_MISMATCH' };
}
