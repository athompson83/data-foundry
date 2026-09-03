/** Cloudflare composition root. Hyperdrive graphs are always invocation-owned. */
import {
  createCanonicalStore,
  createHyperdriveDriver,
  createPostgresDriver,
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  type PostgresDriverOptions,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import { createQueryModel } from '@data-foundry/query-model';
import type { Slug, VerticalId } from '@data-foundry/canonical-schema';
import { createSdkHandler } from './sdk-server.js';
import {
  McpWorkerConfigurationError,
  resolveMcpWorkerConfig,
  type McpWorkerEnv,
} from './env.js';
import type { McpHttpHandler } from '@modelcontextprotocol/server';

export interface CompiledMcpTool {
  readonly name: string;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly input_schema: Readonly<Record<string, unknown>>;
  readonly error_codes: readonly string[];
}

export interface McpWorkerRuntime {
  readonly vertical_slug: string;
  readonly canonical_url_prefix: string;
  readonly fields: readonly unknown[];
  readonly fact_selection: Readonly<Record<string, unknown>>;
  readonly server: {
    readonly name: string;
    readonly version: string;
    readonly transport: 'streamable_http';
    readonly endpoint: '/mcp';
  };
  readonly tools: readonly CompiledMcpTool[];
}

export interface McpDeployment {
  readonly handler: McpHttpHandler;
  readonly driver: SqlDriver;
  readonly verticalId: VerticalId;
  readonly close: () => Promise<void>;
}

export interface BuildMcpDeploymentOptions {
  readonly env: McpWorkerEnv;
  readonly runtime: McpWorkerRuntime;
  readonly openDriver?: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
  /** Receives fixed classifications only; never request or exception material. */
  readonly onToolError?: (context: { readonly tool: string; readonly code: string }) => void;
  readonly onProtocolError?: () => void;
}

const deployments = new Map<string, Promise<McpDeployment>>();

async function build(options: BuildMcpDeploymentOptions): Promise<McpDeployment> {
  const config = resolveMcpWorkerConfig(options.env);
  if (options.runtime.vertical_slug !== config.verticalSlug) {
    throw new McpWorkerConfigurationError(
      `The bundle contains ${options.runtime.vertical_slug}, not configured vertical ${config.verticalSlug}.`,
    );
  }
  if (
    !options.runtime.canonical_url_prefix.startsWith('/') ||
    options.runtime.canonical_url_prefix.endsWith('/')
  ) {
    throw new McpWorkerConfigurationError('The compiled MCP canonical URL prefix is invalid.');
  }

  const open = options.openDriver ?? (
    options.env.HYPERDRIVE === undefined ? createPostgresDriver : createHyperdriveDriver
  );
  const driver = await open(
    config.connectionString,
    config.deploymentEnvironment === 'production'
      ? { schema: DATA_FOUNDRY_PRIVATE_SCHEMA }
      : options.env.HYPERDRIVE === undefined
        ? { allowPlaintextLoopback: true }
        : undefined,
  );
  try {
    const store = createCanonicalStore(driver);
    const vertical = await store.getVerticalBySlug(config.verticalSlug as Slug);
    if (vertical === null) {
      throw new McpWorkerConfigurationError(
        `Configured vertical ${config.verticalSlug} is absent from the canonical database.`,
      );
    }
    const queryModel = createQueryModel(store, { fields: options.runtime.fields as never });
    const handler = createSdkHandler({
      runtime: options.runtime,
      queryModel,
      vertical: { id: vertical.id, slug: vertical.slug },
      canonicalUrlBase: `${config.publicOrigin}${options.runtime.canonical_url_prefix}`,
      ...(options.onToolError === undefined ? {} : { onToolError: options.onToolError }),
      ...(options.onProtocolError === undefined
        ? {}
        : { onProtocolError: options.onProtocolError }),
    });
    return {
      handler,
      driver,
      verticalId: vertical.id,
      close: async () => {
        try {
          await handler.close();
        } finally {
          // Hyperdrive clients are invocation-owned. SDK cleanup must not
          // prevent the underlying database connection from being released.
          await driver.close();
        }
      },
    };
  } catch (error) {
    await driver.close().catch(() => undefined);
    throw error;
  }
}

export function getMcpDeployment(options: BuildMcpDeploymentOptions): Promise<McpDeployment> {
  const config = resolveMcpWorkerConfig(options.env);
  if (options.env.HYPERDRIVE !== undefined) return build(options);

  const key = [
    config.deploymentEnvironment,
    config.connectionString,
    config.verticalSlug,
    config.publicOrigin,
    options.runtime.server.name,
    options.runtime.server.version,
  ].join(' ');
  const cached = deployments.get(key);
  if (cached !== undefined) return cached;
  const pending = build(options).catch((error: unknown) => {
    deployments.delete(key);
    throw error;
  });
  deployments.set(key, pending);
  return pending;
}

/** Test seam. A Worker isolate itself never resets a healthy deployment. */
export function resetMcpDeployments(): void {
  deployments.clear();
}
