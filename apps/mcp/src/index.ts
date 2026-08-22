/**
 * `@data-foundry/mcp`
 *
 * The MCP tool/resource contract over the canonical query layer — tool
 * declarations, argument validation and dispatch. AGENTS.md rule 5: this is an
 * interface, not a business-logic owner. It reads through
 * `@data-foundry/query-model` and nothing beneath it, it serializes facts with
 * the shared `toMcpFact` so REST and MCP cannot drift, and it holds no SQL.
 *
 * The transport is deliberately absent. See `src/server.ts`.
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

export {
  DERIVED_FROM as CANONICAL_SCHEMA_SOURCES,
} from './canonical-schemas.js';

export {
  canonicalUrlsUnder,
  noCanonicalUrls,
  type CanonicalUrlBuilder,
  type ClaimView,
  type CompareEntitiesResult,
  type ComparisonRowView,
  type EntityRef,
  type ExplainFactResult,
  type FactSheet,
  type GetEntityResult,
  type ListFactsResult,
  type RedirectNotice,
  type RelationshipEdgeView,
  type SearchEntitiesResult,
  type SearchHitView,
  type TraverseRelationshipsResult,
  type TrustSummary,
  type WithheldFact,
  withheldSourceTokens,
} from './projection.js';

export {
  assertPayloadCarriesNoReviewer,
  assertPayloadCarriesNoWithheldSource,
  namesReviewer,
  reviewerTokens,
  reviewersIn,
} from './guard.js';
