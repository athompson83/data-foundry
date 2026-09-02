/**
 * Structured tool errors.
 *
 * A model calling a tool cannot read a stack trace and cannot tell "you asked
 * for a model that does not exist" apart from "the database fell over" if both
 * arrive as prose. Every failure this app can produce is therefore a code from
 * a closed list, with machine-readable details and an explicit statement of
 * whether repeating the call unchanged could ever help.
 *
 * `retryable` is the field an agent actually acts on: `false` means stop, look
 * at `details`, and change something. Every argument and lookup failure is
 * `false`; only an unmodelled `INTERNAL_ERROR` is `true`.
 *
 * Nothing here echoes an exception's own message or stack. An upstream error
 * string is written for an operator reading a log, and forwarding it to a tool
 * caller leaks internals while telling the caller nothing it can use.
 */

export const MCP_TOOL_ERROR_CODES = [
  /** No tool by that name is declared. `details.available` lists the ones that are. */
  'UNKNOWN_TOOL',
  /** Arguments failed the tool's declared input schema. `details.issues` says where. */
  'INVALID_ARGUMENTS',
  /** The identifier or id resolved to nothing. */
  'ENTITY_NOT_FOUND',
  /** An identifier matched more than one entity; the candidates are returned, not a guess. */
  'AMBIGUOUS_IDENTIFIER',
  /** The entity exists; no source publishes this property for it. */
  'PROPERTY_NOT_RECORDED',
  /** A filter named a field the vertical does not declare as filterable. */
  'UNKNOWN_FIELD',
  /** Comparison needs at least two entities that actually resolved. */
  'TOO_FEW_ENTITIES',
  /**
   * A result was withheld because it would have carried the identity of the
   * staff reviewer behind an editorial correction. Withholding the answer is
   * the correct outcome: see `src/guard.ts`.
   */
  'REVIEWER_IDENTITY_BLOCKED',
  /**
   * A result was withheld because it would have repeated a claim from a source
   * that fails the publish gate (AGENTS.md rule 1). Like the reviewer control,
   * withholding the answer is the correct outcome.
   */
  'UNPUBLISHABLE_SOURCE_BLOCKED',
  /** A complete rights-safe catalog answer exceeds the checked-in work bound. */
  'SERVICE_UNAVAILABLE',
  /** Anything unanticipated. The only retryable code. */
  'INTERNAL_ERROR',
] as const;

export type McpToolErrorCode = (typeof MCP_TOOL_ERROR_CODES)[number];

/** One argument that failed validation, addressed by JSON path. */
export interface ArgumentIssue {
  /** Dotted path into the arguments object; empty string for the root. */
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface McpToolErrorPayload {
  readonly code: McpToolErrorCode;
  readonly message: string;
  /** Machine-readable specifics. Never a stack trace, never an upstream message. */
  readonly details: Readonly<Record<string, unknown>>;
  /** Could the identical call succeed later? Only `INTERNAL_ERROR` is true. */
  readonly retryable: boolean;
}

const RETRYABLE: ReadonlySet<McpToolErrorCode> = new Set<McpToolErrorCode>(['INTERNAL_ERROR']);

/**
 * Thrown inside a tool handler; converted to a failure result by the
 * dispatcher. Handlers throw rather than return so that the guard in
 * `src/guard.ts` — which runs after a handler has produced a payload — can
 * refuse a result the handler believed was finished.
 */
export class McpToolError extends Error {
  override readonly name = 'McpToolError';
  readonly code: McpToolErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: McpToolErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }

  toPayload(): McpToolErrorPayload {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

export const unknownTool = (name: string, available: readonly string[]): McpToolError =>
  new McpToolError(
    'UNKNOWN_TOOL',
    `No tool named "${name}" is declared by this server. Call one of the declared tools, or ` +
      'list them again — the tool set is small and intent-oriented by design.',
    { requested: name, available: [...available] },
  );

export const invalidArguments = (tool: string, issues: readonly ArgumentIssue[]): McpToolError =>
  new McpToolError(
    'INVALID_ARGUMENTS',
    `Arguments for "${tool}" do not satisfy its declared input schema. Fix the listed paths and ` +
      'call again; repeating the same arguments will fail identically.',
    { tool, issues: issues.map((issue) => ({ ...issue })) },
  );

export const entityNotFound = (
  detail: Readonly<Record<string, unknown>>,
  message = 'No canonical entity matches that identifier in this vertical.',
): McpToolError => new McpToolError('ENTITY_NOT_FOUND', message, detail);

export const internalError = (tool: string): McpToolError =>
  new McpToolError(
    'INTERNAL_ERROR',
    `"${tool}" failed for a reason this server does not model. The arguments were accepted, so ` +
      'the call may be worth retrying once.',
    { tool },
  );
