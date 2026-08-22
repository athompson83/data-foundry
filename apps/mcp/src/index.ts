/**
 * `@data-foundry/mcp`
 *
 * The MCP tool/resource contract over the canonical query layer. AGENTS.md
 * rule 5: this is an interface, not a business-logic owner. It reads through
 * `@data-foundry/query-model` and nothing beneath it, and it holds no SQL.
 *
 * The transport is deliberately absent — AGENTS.md names Cloudflare Streamable
 * HTTP as the eventual deployment and it does not exist yet.
 */

export {
  MCP_TOOL_ERROR_CODES,
  McpToolError,
  type ArgumentIssue,
  type McpToolErrorCode,
  type McpToolErrorPayload,
} from './errors.js';

export {
  succeed,
  fail,
  type CallToolResult,
  type TextContent,
  type ToolFailure,
  type ToolOutcome,
  type ToolSuccess,
} from './results.js';

export {
  CompareEntitiesInput,
  ExplainFactInput,
  GetEntityInput,
  ListFactsInput,
  SearchEntitiesInput,
  TraverseRelationshipsInput,
  publishInputSchema,
  type JsonSchemaDocument,
} from './schemas.js';

export { DERIVED_FROM as CANONICAL_SCHEMA_SOURCES } from './canonical-schemas.js';
