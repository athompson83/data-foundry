/**
 * What a deployed Worker is configured with, and what it refuses to start
 * without. Same fail-closed reasoning as `apps/edge/src/env.ts`: a Worker with
 * no database bound must refuse, never fall back to an empty in-memory one.
 *
 * Unlike `apps/edge`, there is no `VERTICAL_SLUG` — this Worker serves every
 * vertical the bundle carries (ADR-0011).
 */

export interface HyperdriveBinding {
  readonly connectionString: string;
}

export interface WebEnv {
  readonly HYPERDRIVE?: HyperdriveBinding;
  readonly POSTGRES_URL?: string;
  /**
   * The public origin this deployment answers on, e.g. `https://example.com`.
   * Used only to render absolute URLs where a spec demands one — the sitemap
   * index and `<link rel="canonical">` — never to build a relative link.
   */
  readonly PUBLIC_ORIGIN?: string;
}

export class WebConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebConfigurationError';
  }
}

export interface ResolvedWebConfig {
  readonly connectionString: string;
  readonly publicOrigin: string;
}

const DEFAULT_ORIGIN = 'http://localhost';

export function resolveWebConfig(env: WebEnv): ResolvedWebConfig {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
  if (connectionString.trim() === '') {
    throw new WebConfigurationError(
      'No database is configured. Bind HYPERDRIVE or set POSTGRES_URL. ' +
        'This Worker will not fall back to an empty in-memory database.',
    );
  }

  const publicOrigin = (env.PUBLIC_ORIGIN ?? '').trim() || DEFAULT_ORIGIN;
  try {
    // eslint-disable-next-line no-new -- validation only, the URL is discarded
    new URL(publicOrigin);
  } catch {
    throw new WebConfigurationError(`PUBLIC_ORIGIN "${publicOrigin}" is not a valid absolute URL.`);
  }

  return { connectionString, publicOrigin: publicOrigin.replace(/\/+$/, '') };
}
