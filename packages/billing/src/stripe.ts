/**
 * The handful of Stripe REST calls self-service billing needs, over `fetch`.
 *
 * No SDK: the Workers bundle stays small, and every request/response field this
 * platform relies on is named here and parsed defensively. Responses are
 * narrowed to what the caller uses; unknown fields are ignored.
 */

export const STRIPE_API_BASE = 'https://api.stripe.com';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly stripeCode: string | null,
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

export interface StripeClientOptions {
  readonly secretKey: string;
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
}

/** Stripe's form encoding: nested keys as `a[b][0][c]=v`. */
export function encodeStripeForm(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  const visit = (prefix: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(`${prefix}[${index}]`, item));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        visit(`${prefix}[${key}]`, nested);
      }
      return;
    }
    pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  };
  for (const [key, value] of Object.entries(params)) visit(key, value);
  return pairs.join('&');
}

export interface CheckoutSessionSummary {
  readonly id: string;
  readonly url: string | null;
  readonly status: string | null;
  readonly paymentStatus: string | null;
  readonly customerId: string | null;
  readonly customerEmail: string | null;
  readonly subscriptionId: string | null;
  readonly subscription: SubscriptionSummary | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface SubscriptionSummary {
  readonly id: string;
  readonly customerId: string | null;
  readonly status: string;
  readonly priceId: string | null;
  readonly currentPeriodEnd: number | null;
  readonly metadata: Readonly<Record<string, string>>;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const idOf = (value: unknown): string | null =>
  typeof value === 'string'
    ? text(value)
    : value !== null && typeof value === 'object'
      ? text((value as { id?: unknown }).id)
      : null;

function metadataOf(value: unknown): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (value === null || typeof value !== 'object') return metadata;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') metadata[key] = entry;
  }
  return metadata;
}

/**
 * Reads a subscription object. The billing period moved from the subscription
 * to its items in newer Stripe API versions, so both locations are read.
 */
export function parseSubscription(value: unknown): SubscriptionSummary | null {
  if (value === null || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw['id']);
  const status = text(raw['status']);
  if (id === null || status === null) return null;
  const items = raw['items'] as { data?: unknown } | undefined;
  const firstItem = Array.isArray(items?.data) ? (items.data[0] as Record<string, unknown> | undefined) : undefined;
  const price = firstItem?.['price'] as Record<string, unknown> | undefined;
  const periodEnd =
    typeof firstItem?.['current_period_end'] === 'number'
      ? (firstItem['current_period_end'] as number)
      : typeof raw['current_period_end'] === 'number'
        ? (raw['current_period_end'] as number)
        : null;
  return {
    id,
    customerId: idOf(raw['customer']),
    status,
    priceId: text(price?.['id']),
    currentPeriodEnd: periodEnd,
    metadata: metadataOf(raw['metadata']),
  };
}

export function parseCheckoutSession(value: unknown): CheckoutSessionSummary {
  if (value === null || typeof value !== 'object') {
    throw new StripeApiError('Stripe returned a malformed checkout session.', 502, null);
  }
  const raw = value as Record<string, unknown>;
  const id = text(raw['id']);
  if (id === null) throw new StripeApiError('Stripe returned a checkout session without an id.', 502, null);
  const subscription =
    raw['subscription'] !== null && typeof raw['subscription'] === 'object'
      ? parseSubscription(raw['subscription'])
      : null;
  const details = raw['customer_details'] as Record<string, unknown> | undefined;
  return {
    id,
    url: text(raw['url']),
    status: text(raw['status']),
    paymentStatus: text(raw['payment_status']),
    customerId: idOf(raw['customer']),
    customerEmail: text(details?.['email']) ?? text(raw['customer_email']),
    subscriptionId: idOf(raw['subscription']),
    subscription,
    metadata: metadataOf(raw['metadata']),
  };
}

export interface CreateCheckoutSessionInput {
  readonly priceId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly customerEmail?: string | undefined;
  readonly metadata: Readonly<Record<string, string>>;
}

export class StripeClient {
  readonly #secretKey: string;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;

  constructor(options: StripeClientOptions) {
    if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(options.secretKey)) {
      throw new StripeApiError('The Stripe secret key is not a Stripe secret or restricted key.', 500, null);
    }
    this.#secretKey = options.secretKey;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#baseUrl = options.baseUrl ?? STRIPE_API_BASE;
  }

  get livemode(): boolean {
    return this.#secretKey.includes('_live_');
  }

  async #request(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const body = encodeStripeForm(params);
    const url = method === 'GET' && body !== '' ? `${this.#baseUrl}${path}?${body}` : `${this.#baseUrl}${path}`;
    const response = await this.#fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${this.#secretKey}`,
        ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(method === 'POST' ? { body } : {}),
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = (payload as { error?: { message?: unknown; code?: unknown } } | null)?.error;
      throw new StripeApiError(
        typeof error?.message === 'string' ? error.message : `Stripe request failed with ${response.status}.`,
        response.status,
        typeof error?.code === 'string' ? error.code : null,
      );
    }
    return payload;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionSummary> {
    const payload = await this.#request('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      metadata: input.metadata,
      subscription_data: { metadata: input.metadata },
    });
    return parseCheckoutSession(payload);
  }

  async retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionSummary> {
    if (!/^cs_(live|test)_[A-Za-z0-9]{10,255}$/.test(sessionId)) {
      throw new StripeApiError('Not a Stripe checkout session id.', 400, 'invalid_session_id');
    }
    const payload = await this.#request('GET', `/v1/checkout/sessions/${sessionId}`, {
      expand: ['subscription'],
    });
    return parseCheckoutSession(payload);
  }

  async createBillingPortalSession(customerId: string, returnUrl: string): Promise<string> {
    const payload = (await this.#request('POST', '/v1/billing_portal/sessions', {
      customer: customerId,
      return_url: returnUrl,
    })) as { url?: unknown } | null;
    const url = text(payload?.url);
    if (url === null) throw new StripeApiError('Stripe returned a portal session without a URL.', 502, null);
    return url;
  }
}
