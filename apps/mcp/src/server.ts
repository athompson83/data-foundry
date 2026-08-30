/**
 * The dispatcher: a tool name plus arguments in, a stable result out.
 *
 * NO TRANSPORT. `apps/mcp-worker` is the Cloudflare Streamable HTTP adapter;
 * JSON-RPC framing, HTTP guards and authentication stay there. This package
 * remains the in-process list of tool declarations plus a function from (name,
 * arguments) to a stable result, testable without a socket. The interesting
 * behaviour is the mapping, and the deployed transport adds only framing and
 * access concerns.
 *
 * `callTool` NEVER THROWS. Every failure — unknown tool, malformed argument,
 * missing entity, an unmodelled exception from below — leaves as a structured
 * result with a code. A dispatcher that throws for one class of failure and
 * returns for another forces the transport to invent the missing half, which is
 * where the two halves start disagreeing.
 *
 * ONE VERTICAL PER SERVER, selected by the deployment and compiled runtime.
 * The vertical id is configuration, never a tool argument: an agent should not be
 * able to address a neighbouring vertical's data by guessing a uuid, and it
 * should not have to know uuids at all.
 */
import { McpToolError, internalError, unknownTool, type McpToolErrorCode } from './errors.js';
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

/** What an operator is told about a failure, beside the cause itself. */
export interface McpErrorContext {
  readonly tool: string;
  /** The code the CALLER was given, so the two ends can be matched up. */
  readonly code: McpToolErrorCode;
}

export interface McpServerOptions {
  /**
   * The canonical query layer. THE ONLY DATA DEPENDENCY. Note what this
   * interface cannot accept: a `CanonicalStore`, a `SqlDriver`, a connection
   * string. There is no configuration of this server that gives it SQL.
   */
  readonly queryModel: QueryModel;
  /** The single vertical selected by the deployment's compiled runtime. */
  readonly vertical: { readonly id: VerticalId; readonly slug: string };
  /**
   * Compiled fact-selection policy for this vertical. Server-side only; see
   * `ToolContext.policy` for why no part of it is caller-controllable.
   */
  readonly policy?: FactSelectionPolicy;
  /** Base URL for canonical pages. Omit and `canonicalUrl` is null everywhere. */
  readonly canonicalUrlBase?: string;
  /**
   * Where the real cause goes. The SAME channel `apps/api` gives its own
   * unmodelled failures, for the same reason: a caller is told an opaque code
   * on purpose — nothing here echoes an exception's message or stack — and an
   * exception nobody is told about is simply gone. There would be no log, no
   * channel and no evidence an operator could act on, only a customer
   * reporting a retryable error that never stops being retryable.
   *
   * Called for what the dispatcher did not model — never for a decided refusal
   * like `ENTITY_NOT_FOUND`, which is an answer rather than a fault, and which
   * would bury the failures that mean something. Defaults to doing nothing so
   * tests stay silent.
   */
  readonly onError?: (error: unknown, context: McpErrorContext) => void;
}

export interface McpServer {
  readonly vertical: string;
  listTools(): readonly ToolDeclaration[];
  /** Never throws. Failures come back as `isError` results with a code. */
  callTool(name: string, args?: unknown): Promise<CallToolResult>;
}

/**
 * Anything a handler or the query layer threw that this app does not model,
 * rendered as a decided failure — the same split `apps/api` makes between
 * `normalize` and its error funnel.
 *
 * `ReviewerIdentityLeak` is the one such throwable with a code of its own: the
 * query layer refuses to project a correction reason that names its reviewer,
 * and that refusal must reach the caller as a refusal rather than as a generic
 * internal error. Never with the offending text attached, which is why this
 * maps to a fixed message instead of forwarding one. Everything else collapses
 * to `INTERNAL_ERROR`; the cause goes to the operator channel and nowhere else.
 */
function normalize(tool: string, error: unknown): McpToolError {
  if (error instanceof ReviewerIdentityLeak) {
    return new McpToolError(
      'REVIEWER_IDENTITY_BLOCKED',
      'This result was withheld: the editorial correction behind one of its values has a ' +
        'declared reason that names the staff reviewer who made it. The reason is ' +
        'customer-visible by contract; the reviewer is not. Fix the override reason in ' +
        "the vertical's fact-selection config.",
      { withheld: error.field },
    );
  }
  return internalError(tool);
}

/**
 * Hand the cause to the operator channel, and never let that be the thing that
 * breaks the call.
 *
 * `callTool` NEVER THROWS is the contract this file's header states and the one
 * a transport is written against. A sink is supplied by whoever composes the
 * server — a logger, an exception tracker, something that can be misconfigured
 * or itself be down — and a throw from it would turn a structured failure into
 * a rejected promise, which is precisely the shape the dispatcher exists to
 * stop the transport having to invent.
 */
function report(
  sink: McpServerOptions['onError'],
  error: unknown,
  context: McpErrorContext,
): void {
  if (sink === undefined) return;
  try {
    sink(error, context);
  } catch {
    // Nothing to do with it: reporting a reporting failure needs a reporter.
  }
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

  const contextBase: Omit<ToolContext, 'queryModel'> = {
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
        // Bind at call time, not server construction time. A long-lived MCP
        // process must observe terms revocation/re-review expiry without a
        // restart, and one call gets one immutable cached rights snapshot.
        const context: ToolContext = {
          ...contextBase,
          queryModel: options.queryModel.forSurface('MCP'),
        };
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
        // A modelled error is a decided answer: the handler already chose what
        // the caller is told, and there is nothing here an operator needs.
        if (error instanceof McpToolError) return fail(name, error.toPayload());

        const failure = normalize(name, error);
        report(options.onError, error, { tool: name, code: failure.code });
        return fail(name, failure.toPayload());
      }
    },
  };
}
