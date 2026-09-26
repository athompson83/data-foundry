/**
 * What a deployed Worker is configured with, and what it refuses to start without.
 *
 * Every field here fails closed. The reason is specific rather than defensive:
 * `createDriverFromEnv` in the store falls back to PGlite when no connection
 * string is set, which is exactly right for tests and catastrophic at the edge —
 * a misconfigured deployment would boot happily and serve an **empty in-memory
 * database** as though it were the product. Nobody would see an error; they
 * would see zero results. So this module never calls that helper, and a Worker
 * with no database refuses to answer at all.
 */

import type { KeyEnvironment } from '@data-foundry/api-keys';
import { API_PATH_PREFIX_PATTERN } from './path-prefix.js';
import {
  canonicalizeEndpointHostname,
  isUnsafeCanonicalProductionHostname,
} from '@data-foundry/canonical-schema';

/** Cloudflare's Hyperdrive binding, narrowed to the one field we read. */
export interface HyperdriveBinding {
  readonly connectionString: string;
}

/**
 * Cloudflare's Queue producer binding, narrowed to the one method a producer
 * calls. Named locally rather than pulled from `@cloudflare/workers-types` —
 * this repository types every Cloudflare binding it touches by the shape it
 * reads, the same choice `HyperdriveBinding` already made, so a binding this
 * Worker does not use cannot widen what it is trusted with.
 */
export interface QueueBinding<Message = unknown> {
  send(message: Message): Promise<void>;
}

export interface EdgeEnv {
  /** Explicit deployment identity; absence is rejected. */
  readonly DEPLOYMENT_ENVIRONMENT?: string | undefined;
  /** Enables only the route-less, service-bound synthetic readiness probe. */
  readonly PRIVATE_CANARY_MODE?: string | undefined;
  /**
   * Hyperdrive binding. Preferred over `POSTGRES_URL`: it pools connections at
   * Cloudflare's edge, which is what makes Postgres viable from a Worker at all.
   */
  readonly HYPERDRIVE?: HyperdriveBinding;
  /** Direct connection string. A fallback for `wrangler dev` against a local database. */
  readonly POSTGRES_URL?: string;
  /** Which vertical this deployment serves. One vertical per Worker. */
  readonly VERTICAL_SLUG?: string;
  /**
   * Public path prefix for the canonical `api.data.aroqon.com/v1/<slug>/...`
   * contract (ADR-0012). Optional and explicit: when absent the Worker serves
   * the un-prefixed `/v1/...` surface exactly as before. When present it must be
   * exactly `/v1/${VERTICAL_SLUG}`; see `path-prefix.ts`.
   */
  readonly API_PATH_PREFIX?: string;
  /** Which credential namespace this deployment accepts. Never inferred. */
  readonly API_KEY_ENVIRONMENT?: string;
  /** Hostname reserved for requests proxied by RapidAPI. No scheme or path. */
  readonly RAPIDAPI_HOSTNAME?: string;
  /** RapidAPI's origin-verification secret. Configure as a Worker secret. */
  readonly RAPIDAPI_PROXY_SECRET?: string;
  /** Server-held Data Foundry key issued as RAPIDAPI/RAPIDAPI for one vertical. */
  readonly RAPIDAPI_API_KEY?: string;
  /**
   * Durable handoff for usage events. Optional in the type so local/test code
   * can prove the missing-binding failure; production configuration requires
   * it, and an authenticated GET/HEAD returns 503 unless `send` is accepted.
   * Database persistence remains asynchronous in the queue consumer.
   */
  readonly USAGE_EVENTS_QUEUE?: QueueBinding;
  /** Stripe secret (or restricted) key. Configure as a Worker secret. */
  readonly STRIPE_SECRET_KEY?: string;
  /** Signing secret of this deployment's Stripe webhook endpoint. Worker secret. */
  readonly STRIPE_WEBHOOK_SECRET?: string;
  /** JSON object mapping each paid plan code to its Stripe price id. */
  readonly STRIPE_PRICE_IDS?: string;
  /** HTTPS origin customers reach this API on; Checkout returns here to claim a key. */
  readonly BILLING_PUBLIC_ORIGIN?: string;
  /** HTTPS page Checkout cancels to and the billing portal returns to. */
  readonly BILLING_RETURN_URL?: string;
}

export class EdgeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdgeConfigurationError';
  }
}

export interface ResolvedEdgeConfig {
  readonly connectionString: string;
  readonly verticalSlug: string;
  /** `/v1/<slug>` when this deployment serves a vertical-scoped path, else `null`. */
  readonly apiPathPrefix: string | null;
  readonly apiKeyEnvironment: KeyEnvironment;
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly rapidApi: RapidApiConfig | null;
  readonly billing: BillingConfig | null;
}

export interface BillingConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly priceIdsJson: string;
  readonly publicOrigin: string;
  readonly returnUrl: string;
}

export type DeploymentEnvironment = 'development' | 'production';

export interface RapidApiConfig {
  readonly hostname: string;
  readonly proxySecret: string;
  readonly apiKey: string;
}

function resolveDeploymentEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value === 'development') return 'development';
  if (value === 'production') return 'production';
  throw new EdgeConfigurationError(
    'DEPLOYMENT_ENVIRONMENT must be exactly "development" or "production".',
  );
}

function resolveRapidApiConfig(
  env: EdgeEnv,
  deploymentEnvironment: DeploymentEnvironment,
): RapidApiConfig | null {
  const anyConfigured =
    env.RAPIDAPI_HOSTNAME !== undefined ||
    env.RAPIDAPI_PROXY_SECRET !== undefined ||
    env.RAPIDAPI_API_KEY !== undefined;
  if (!anyConfigured) return null;

  const hostname = canonicalizeEndpointHostname(env.RAPIDAPI_HOSTNAME ?? '');
  const proxySecret = env.RAPIDAPI_PROXY_SECRET ?? '';
  const apiKey = env.RAPIDAPI_API_KEY ?? '';
  if (hostname === '' || proxySecret === '' || apiKey === '') {
    throw new EdgeConfigurationError(
      'RapidAPI configuration is incomplete. RAPIDAPI_HOSTNAME, ' +
        'RAPIDAPI_PROXY_SECRET, and RAPIDAPI_API_KEY must be configured together.',
    );
  }
  if (deploymentEnvironment === 'production' && isUnsafeCanonicalProductionHostname(hostname)) {
    throw new EdgeConfigurationError(
      'RAPIDAPI_HOSTNAME must be a canonical production hostname; IP literals (including loopback and unspecified), special-use names, and provider fallback zones are refused.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${hostname}`);
  } catch {
    throw new EdgeConfigurationError('RAPIDAPI_HOSTNAME must be a hostname without a scheme or path.');
  }
  if (
    parsed.hostname.toLowerCase() !== hostname ||
    parsed.port !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new EdgeConfigurationError('RAPIDAPI_HOSTNAME must be a hostname without a scheme or path.');
  }
  return { hostname, proxySecret, apiKey };
}

function httpsUrl(value: string, label: string, originOnly: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new EdgeConfigurationError(`${label} must be an absolute HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new EdgeConfigurationError(`${label} must be an absolute HTTPS URL.`);
  }
  if (originOnly && (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '')) {
    throw new EdgeConfigurationError(`${label} must be an origin without a path.`);
  }
  return originOnly ? parsed.origin : parsed.toString();
}

/**
 * Self-service billing is all-or-nothing, like the RapidAPI channel: a
 * partially configured deployment refuses to start rather than selling plans
 * it cannot provision. Production accepts only live-mode Stripe keys, because
 * a test key would hand out live API credentials for fake payments.
 */
function resolveBillingConfig(
  env: EdgeEnv,
  deploymentEnvironment: DeploymentEnvironment,
): BillingConfig | null {
  const values = [
    env.STRIPE_SECRET_KEY,
    env.STRIPE_WEBHOOK_SECRET,
    env.STRIPE_PRICE_IDS,
    env.BILLING_PUBLIC_ORIGIN,
    env.BILLING_RETURN_URL,
  ];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => value === undefined || value.trim() === '')) {
    throw new EdgeConfigurationError(
      'Billing configuration is incomplete. STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ' +
        'STRIPE_PRICE_IDS, BILLING_PUBLIC_ORIGIN, and BILLING_RETURN_URL must be configured together.',
    );
  }
  const secretKey = (env.STRIPE_SECRET_KEY ?? '').trim();
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(secretKey)) {
    throw new EdgeConfigurationError('STRIPE_SECRET_KEY is not a Stripe secret or restricted key.');
  }
  if (deploymentEnvironment === 'production' && !secretKey.includes('_live_')) {
    throw new EdgeConfigurationError('Production billing requires a live-mode Stripe key.');
  }
  const webhookSecret = (env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (!webhookSecret.startsWith('whsec_')) {
    throw new EdgeConfigurationError('STRIPE_WEBHOOK_SECRET is not a Stripe webhook signing secret.');
  }
  return {
    secretKey,
    webhookSecret,
    priceIdsJson: env.STRIPE_PRICE_IDS ?? '',
    publicOrigin: httpsUrl((env.BILLING_PUBLIC_ORIGIN ?? '').trim(), 'BILLING_PUBLIC_ORIGIN', true),
    returnUrl: httpsUrl((env.BILLING_RETURN_URL ?? '').trim(), 'BILLING_RETURN_URL', false),
  };
}

/**
 * The optional public path prefix. Absent means the historical un-prefixed
 * surface. Present means exactly `/v1/<VERTICAL_SLUG>`: a prefix naming another
 * vertical would route one vertical's public path to a Worker whose QueryModel
 * carries a different vertical's field metadata, so it refuses to start rather
 * than answer. An empty or padded value is a misconfiguration, not "absent".
 */
function resolveApiPathPrefix(value: string | undefined, verticalSlug: string): string | null {
  if (value === undefined) return null;
  if (!API_PATH_PREFIX_PATTERN.test(value)) {
    throw new EdgeConfigurationError(
      'API_PATH_PREFIX must match ^/v1/[a-z][a-z0-9-]{0,62}$ when configured.',
    );
  }
  if (value !== `/v1/${verticalSlug}`) {
    throw new EdgeConfigurationError('API_PATH_PREFIX must equal /v1/<VERTICAL_SLUG> exactly.');
  }
  return value;
}

/**
 * Read the deployment's configuration, or refuse.
 *
 * Hyperdrive wins over `POSTGRES_URL` when both are present: if an operator has
 * bound Hyperdrive, going around it to talk to the origin directly is never what
 * they meant.
 */
export function resolveEdgeConfig(env: EdgeEnv): ResolvedEdgeConfig {
  const deploymentEnvironment = resolveDeploymentEnvironment(env.DEPLOYMENT_ENVIRONMENT);
  if (deploymentEnvironment === 'production' && env.HYPERDRIVE === undefined) {
    throw new EdgeConfigurationError(
      'Production requires the HYPERDRIVE binding; POSTGRES_URL is for local development only.',
    );
  }
  const connectionString = deploymentEnvironment === 'production'
    ? env.HYPERDRIVE?.connectionString ?? ''
    : env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
  if (connectionString.trim() === '') {
    throw new EdgeConfigurationError(
      'No database is configured. Bind HYPERDRIVE or set POSTGRES_URL. ' +
        'This Worker will not fall back to an empty in-memory database.',
    );
  }

  const verticalSlug = (env.VERTICAL_SLUG ?? '').trim();
  if (verticalSlug === '') {
    throw new EdgeConfigurationError(
      'VERTICAL_SLUG is not set. A deployment serves exactly one vertical, ' +
        'because a QueryModel carries exactly one vertical’s field metadata.',
    );
  }

  const apiKeyEnvironment = env.API_KEY_ENVIRONMENT ?? '';
  if (apiKeyEnvironment !== 'live' && apiKeyEnvironment !== 'test') {
    throw new EdgeConfigurationError(
      'API_KEY_ENVIRONMENT must be set explicitly to "live" or "test". ' +
        'A deployment must never infer which credential namespace it accepts.',
    );
  }
  if (deploymentEnvironment === 'production' && apiKeyEnvironment !== 'live') {
    throw new EdgeConfigurationError('Production requires API_KEY_ENVIRONMENT="live".');
  }
  if (deploymentEnvironment === 'production' && env.USAGE_EVENTS_QUEUE === undefined) {
    throw new EdgeConfigurationError(
      'Production requires the USAGE_EVENTS_QUEUE binding for asynchronous metering.',
    );
  }

  return {
    connectionString,
    verticalSlug,
    apiPathPrefix: resolveApiPathPrefix(env.API_PATH_PREFIX, verticalSlug),
    apiKeyEnvironment,
    deploymentEnvironment,
    rapidApi: resolveRapidApiConfig(env, deploymentEnvironment),
    billing: resolveBillingConfig(env, deploymentEnvironment),
  };
}
