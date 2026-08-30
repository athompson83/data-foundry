/** Fail-closed deployment configuration for the remote MCP Worker. */
import type { KeyEnvironment } from '@data-foundry/api-keys';
import {
  isLoopbackEndpointHostname,
  isUnsafeProductionEndpointHostname,
} from '@data-foundry/canonical-schema';

export interface HyperdriveBinding {
  readonly connectionString: string;
}

export interface QueueBinding<Message = unknown> {
  send(message: Message): Promise<void>;
}

export interface McpWorkerEnv {
  readonly DEPLOYMENT_ENVIRONMENT?: string | undefined;
  readonly HYPERDRIVE?: HyperdriveBinding | undefined;
  readonly POSTGRES_URL?: string | undefined;
  readonly VERTICAL_SLUG?: string | undefined;
  readonly API_KEY_ENVIRONMENT?: string | undefined;
  /** Exact hostname accepted by the Host guard. Ports are ignored by design. */
  readonly MCP_HOSTNAME?: string | undefined;
  /** Comma-separated, exact origins. A request without Origin remains valid. */
  readonly MCP_ALLOWED_ORIGINS?: string | undefined;
  /** Public web origin used to build canonical entity URLs. */
  readonly PUBLIC_ORIGIN?: string | undefined;
  readonly USAGE_EVENTS_QUEUE?: QueueBinding | undefined;
}

export class McpWorkerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpWorkerConfigurationError';
  }
}

export type DeploymentEnvironment = 'development' | 'production';

export interface ResolvedMcpWorkerConfig {
  readonly connectionString: string;
  readonly verticalSlug: string;
  readonly apiKeyEnvironment: KeyEnvironment;
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly hostname: string;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly publicOrigin: string;
}

function deploymentEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value === 'development') return 'development';
  if (value === 'production') return 'production';
  throw new McpWorkerConfigurationError(
    'DEPLOYMENT_ENVIRONMENT must be exactly "development" or "production".',
  );
}

function exactHostname(value: string | undefined, deployment: DeploymentEnvironment): string {
  const hostname = (value ?? '').trim().toLowerCase();
  if (hostname === '') {
    throw new McpWorkerConfigurationError('MCP_HOSTNAME is required.');
  }
  if (deployment === 'production' && isUnsafeProductionEndpointHostname(hostname)) {
    throw new McpWorkerConfigurationError(
      'MCP_HOSTNAME must not be a loopback or unspecified hostname in production.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(`https://${hostname}`);
  } catch {
    throw new McpWorkerConfigurationError(
      'MCP_HOSTNAME must be one hostname without a scheme, port, path, query, or fragment.',
    );
  }
  if (
    parsed.hostname.toLowerCase() !== hostname ||
    parsed.port !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new McpWorkerConfigurationError(
      'MCP_HOSTNAME must be one hostname without a scheme, port, path, query, or fragment.',
    );
  }
  return hostname;
}

function exactOrigin(value: string, label: string, deployment: DeploymentEnvironment): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new McpWorkerConfigurationError(`${label} must contain valid absolute origins.`);
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.origin !== value
  ) {
    throw new McpWorkerConfigurationError(
      `${label} values must be origins only, without credentials, paths, queries, or fragments.`,
    );
  }
  if (deployment === 'production' && (parsed.protocol !== 'https:' || isUnsafeProductionEndpointHostname(parsed.hostname))) {
    throw new McpWorkerConfigurationError(`${label} must use HTTPS and a non-loopback, non-unspecified hostname in production.`);
  }
  if (deployment === 'development' && parsed.protocol !== 'https:' && !isLoopbackEndpointHostname(parsed.hostname)) {
    throw new McpWorkerConfigurationError(`${label} must use HTTPS outside local development.`);
  }
  return parsed.origin;
}

function allowedOrigins(value: string | undefined, deployment: DeploymentEnvironment): ReadonlySet<string> {
  const raw = value ?? '';
  const entries = raw.split(',').map((entry) => entry.trim());
  if (entries.length === 0 || entries.some((entry) => entry === '')) {
    throw new McpWorkerConfigurationError(
      'MCP_ALLOWED_ORIGINS must list one or more comma-separated exact origins.',
    );
  }
  return new Set(entries.map((entry) => exactOrigin(entry, 'MCP_ALLOWED_ORIGINS', deployment)));
}

export function resolveMcpWorkerConfig(env: McpWorkerEnv): ResolvedMcpWorkerConfig {
  const deployment = deploymentEnvironment(env.DEPLOYMENT_ENVIRONMENT);
  if (deployment === 'production' && env.HYPERDRIVE === undefined) {
    throw new McpWorkerConfigurationError(
      'Production requires the HYPERDRIVE binding; POSTGRES_URL is for local development only.',
    );
  }
  const connectionString = deployment === 'production'
    ? env.HYPERDRIVE?.connectionString ?? ''
    : env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
  if (connectionString.trim() === '') {
    throw new McpWorkerConfigurationError(
      'No database is configured. Bind HYPERDRIVE or set POSTGRES_URL; MCP never falls back to PGlite.',
    );
  }

  const verticalSlug = (env.VERTICAL_SLUG ?? '').trim();
  if (verticalSlug === '') {
    throw new McpWorkerConfigurationError(
      'VERTICAL_SLUG is required because one MCP deployment serves exactly one vertical.',
    );
  }

  const apiKeyEnvironment = env.API_KEY_ENVIRONMENT ?? '';
  if (apiKeyEnvironment !== 'live' && apiKeyEnvironment !== 'test') {
    throw new McpWorkerConfigurationError(
      'API_KEY_ENVIRONMENT must be set explicitly to "live" or "test".',
    );
  }
  if (deployment === 'production' && apiKeyEnvironment !== 'live') {
    throw new McpWorkerConfigurationError('Production requires API_KEY_ENVIRONMENT="live".');
  }
  if (deployment === 'production' && env.USAGE_EVENTS_QUEUE === undefined) {
    throw new McpWorkerConfigurationError(
      'Production requires the USAGE_EVENTS_QUEUE binding for analytics delivery.',
    );
  }

  const publicOriginValue = (env.PUBLIC_ORIGIN ?? '').trim();
  if (publicOriginValue === '') {
    throw new McpWorkerConfigurationError(
      'PUBLIC_ORIGIN is required for canonical entity URLs.',
    );
  }

  return {
    connectionString,
    verticalSlug,
    apiKeyEnvironment,
    deploymentEnvironment: deployment,
    hostname: exactHostname(env.MCP_HOSTNAME, deployment),
    allowedOrigins: allowedOrigins(env.MCP_ALLOWED_ORIGINS, deployment),
    publicOrigin: exactOrigin(publicOriginValue, 'PUBLIC_ORIGIN', deployment),
  };
}
