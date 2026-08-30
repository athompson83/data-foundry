/** Official MCP SDK wiring around the transport-free `apps/mcp` contract. */
import {
  McpServer as SdkMcpServer,
  createMcpHandler,
  type CallToolResult as SdkCallToolResult,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import {
  TOOLS,
  createMcpServer,
  type McpErrorContext,
} from '@data-foundry/mcp';
import type { QueryModel } from '@data-foundry/query-model';
import type { VerticalId } from '@data-foundry/canonical-schema';
import type { McpWorkerRuntime } from './composition.js';

export interface SdkHandlerOptions {
  readonly runtime: McpWorkerRuntime;
  readonly queryModel: QueryModel;
  readonly vertical: { readonly id: VerticalId; readonly slug: string };
  readonly canonicalUrlBase: string;
  readonly onToolError?: (context: McpErrorContext) => void;
  readonly onProtocolError?: () => void;
}

function asSdkResult(result: Awaited<ReturnType<ReturnType<typeof createMcpServer>['callTool']>>): SdkCallToolResult {
  return {
    isError: result.isError,
    content: result.content.map((block) => ({ type: block.type, text: block.text })),
    structuredContent: { ...result.structuredContent },
  };
}

/**
 * `createMcpHandler` calls this factory once per HTTP exchange. The canonical
 * QueryModel and driver stay pooled, while the SDK and pure dispatcher carry
 * no session or caller state across requests.
 */
export function createSdkHandler(options: SdkHandlerOptions): McpHttpHandler {
  const runtimeTools = new Map(options.runtime.tools.map((tool) => [tool.name, tool] as const));
  return createMcpHandler(
    () => {
      const pure = createMcpServer({
        queryModel: options.queryModel,
        vertical: options.vertical,
        policy: options.runtime.fact_selection as never,
        canonicalUrlBase: options.canonicalUrlBase,
        onError: (_error: unknown, context: McpErrorContext) => options.onToolError?.(context),
      });
      const sdk = new SdkMcpServer({
        name: options.runtime.server.name,
        version: options.runtime.server.version,
      });

      for (const executable of TOOLS) {
        const metadata = runtimeTools.get(executable.name);
        if (metadata === undefined) {
          throw new Error('compiled MCP runtime omitted an executable tool');
        }
        sdk.registerTool(
          executable.name,
          {
            title: metadata.title,
            description: metadata.description,
            inputSchema: executable.input,
          },
          async (args) => asSdkResult(await pure.callTool(executable.name, args)),
        );
      }
      return sdk;
    },
    {
      legacy: 'stateless',
      onerror: () => options.onProtocolError?.(),
    },
  );
}
