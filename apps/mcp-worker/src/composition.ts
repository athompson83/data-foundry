/** Cloudflare composition root: one pooled database/query graph per isolate. */
import {
  createCanonicalStore,
  createPostgresDriver,
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
    readonly server_card: string;
    readonly agent_card: string;
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
  readonly openDriver?: (connectionString: string) => Promise<SqlDriver>;
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

  const driver = await (options.openDriver ?? createPostgresDriver)(config.connectionString);
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
        await handler.close();
        await driver.close();
      },
    };
  } catch (error) {
    await driver.close().catch(() => undefined);
    throw error;
  }
}

export function getMcpDeployment(options: BuildMcpDeploymentOptions): Promise<McpDeployment> {
  const config = resolveMcpWorkerConfig(options.env);
  const key = [
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
