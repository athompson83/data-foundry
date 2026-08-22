/**
 * The dispatcher: a tool name plus arguments in, a stable result out.
 *
 * NO TRANSPORT. AGENTS.md names Cloudflare Streamable HTTP as the eventual
 * deployment and it does not exist yet, so there is deliberately no JSON-RPC
 * framing, no stdio loop and no HTTP handler here. What a transport will need
 * is this: a list of tool declarations, and a function from (name, arguments)
 * to an MCP-shaped result that never throws. Both are in-process and testable
 * without a socket, which is the point — the interesting behaviour is the
 * mapping, and a transport wrapped around it should be able to add nothing but
 * framing.
 *
 * `callTool` NEVER THROWS. Every failure — unknown tool, malformed argument,
 * missing entity, an unmodelled exception from below — leaves as a structured
 * result with a code. A dispatcher that throws for one class of failure and
 * returns for another forces the transport to invent the missing half, which is
 * where the two halves start disagreeing.
 *
 * ONE VERTICAL PER SERVER, matching `mcp.yaml` (`server.vertical`). The
 * vertical id is configuration, never a tool argument: an agent should not be
 * able to address a neighbouring vertical's data by guessing a uuid, and it
 * should not have to know uuids at all.
 */
import { McpToolError, internalError, unknownTool } from './errors.js';
import { ReviewerIdentityLeak, type FactSelectionPolicy, type QueryModel, type VerticalId } from './query-layer.js';
import { fail, succeed, type CallToolResult } from './results.js';
import {
  canonicalUrlsUnder,
  noCanonicalUrls,
  type CanonicalUrlBuilder,
} from './projection.js';
import {
  TOOLS,
  TOOL_NAMES,
  assertPayloadCarriesNoReviewer,
  assertPayloadCarriesNoWithheldSource,
  type ToolContext,
  type ToolDefinition,
} from './tools.js';

/** A tool as it is advertised to a client. */
export interface ToolDeclaration {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** The codes this tool can return. Part of the contract, not documentation. */
  readonly errorCodes: readonly string[];
}

export interface McpServerOptions {
  /**
   * The canonical query layer. THE ONLY DATA DEPENDENCY. Note what this
   * interface cannot accept: a `CanonicalStore`, a `SqlDriver`, a connection
   * string. There is no configuration of this server that gives it SQL.
   */
  readonly queryModel: QueryModel;
  /** The single vertical served, as declared in the vertical's `mcp.yaml`. */
  readonly vertical: { readonly id: VerticalId; readonly slug: string };
  /**
   * Compiled fact-selection policy for this vertical. Server-side only; see
   * `ToolContext.policy` for why no part of it is caller-controllable.
   */
  readonly policy?: FactSelectionPolicy;
  /** Base URL for canonical pages. Omit and `canonicalUrl` is null everywhere. */
  readonly canonicalUrlBase?: string;
}

export interface McpServer {
  readonly vertical: string;
  listTools(): readonly ToolDeclaration[];
  /** Never throws. Failures come back as `isError` results with a code. */
  callTool(name: string, args?: unknown): Promise<CallToolResult>;
}

const declare = (tool: ToolDefinition): ToolDeclaration => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  errorCodes: [...tool.errors],
});

export function createMcpServer(options: McpServerOptions): McpServer {
  const canonicalUrl: CanonicalUrlBuilder =
    options.canonicalUrlBase === undefined
      ? noCanonicalUrls
      : canonicalUrlsUnder(options.canonicalUrlBase);

  const context: ToolContext = {
    queryModel: options.queryModel,
    vertical: options.vertical,
    policy: options.policy ?? {},
    canonicalUrl,
  };

  const byName = new Map<string, ToolDefinition>(TOOLS.map((tool) => [tool.name, tool] as const));

  return {
    vertical: options.vertical.slug,

    listTools: () => TOOLS.map(declare),

    callTool: async (name, args) => {
      const tool = byName.get(name);
      if (tool === undefined) return fail(null, unknownTool(name, TOOL_NAMES).toPayload());

      try {
        // `invoke` validates against the tool's declared input schema before
        // the handler runs; there is no path from here to a handler that
        // skips it.
        const guarded = await tool.invoke(context, args);

        // Layer 2 of the reviewer control, applied centrally so a new tool
        // cannot forget it. Runs on the finished payload, after the handler
        // believed it was done.
        assertPayloadCarriesNoReviewer(guarded.result, guarded.reviewerTokens);
        assertPayloadCarriesNoWithheldSource(guarded.result, guarded.withheldSourceTokens);

        return succeed(name, guarded.result);
      } catch (error: unknown) {
        if (error instanceof McpToolError) return fail(name, error.toPayload());

        // The query layer refuses to project a correction reason that names
        // its reviewer. That refusal must reach the caller as a refusal, not
        // as a 500 — and never with the offending text attached, which is why
        // this maps to a fixed message rather than forwarding one.
        if (error instanceof ReviewerIdentityLeak) {
          return fail(
            name,
            new McpToolError(
              'REVIEWER_IDENTITY_BLOCKED',
              'This result was withheld: the editorial correction behind one of its values has a ' +
                'declared reason that names the staff reviewer who made it. The reason is ' +
                'customer-visible by contract; the reviewer is not. Fix the override reason in ' +
                "the vertical's fact-selection config.",
              { withheld: error.field },
            ).toPayload(),
          );
        }

        return fail(name, internalError(name).toPayload());
      }
    },
  };
}
