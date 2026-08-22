/**
 * The result envelope, and why it has this shape.
 *
 * The transport is out of scope here (AGENTS.md names Cloudflare Streamable
 * HTTP as the eventual deployment, and it does not exist yet), so dispatch is a
 * plain in-process function. What it returns is nonetheless shaped like an MCP
 * `CallToolResult` — `isError`, a `content` block and `structuredContent` —
 * because that shape is the contract a transport will have to produce, and a
 * dispatcher that returns something else just moves the mapping somewhere
 * untested.
 *
 * `structuredContent` is the authority; `content` is the same object serialized
 * for clients that only read text. They are generated from one value, so they
 * cannot disagree.
 */
import type { McpToolErrorPayload } from './errors.js';

export interface ToolSuccess<T> {
  readonly ok: true;
  readonly tool: string;
  readonly result: T;
}

export interface ToolFailure {
  readonly ok: false;
  /** Null when the failure is that no such tool exists. */
  readonly tool: string | null;
  readonly error: McpToolErrorPayload;
}

export type ToolOutcome<T> = ToolSuccess<T> | ToolFailure;

export interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface CallToolResult<T = unknown> {
  readonly isError: boolean;
  readonly content: readonly TextContent[];
  readonly structuredContent: ToolOutcome<T>;
}

const asText = (value: unknown): TextContent => ({
  type: 'text',
  text: JSON.stringify(value, null, 2),
});

export function succeed<T>(tool: string, result: T): CallToolResult<T> {
  const structuredContent: ToolSuccess<T> = { ok: true, tool, result };
  return { isError: false, content: [asText(structuredContent)], structuredContent };
}

export function fail(tool: string | null, error: McpToolErrorPayload): CallToolResult<never> {
  const structuredContent: ToolFailure = { ok: false, tool, error };
  return { isError: true, content: [asText(structuredContent)], structuredContent };
}
