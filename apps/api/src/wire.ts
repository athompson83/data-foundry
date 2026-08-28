/**
 * Internal snake_case -> validated REST wire contract.
 *
 * The Zod objects in this file are the runtime boundary used by route
 * serialization and the source projected into OpenAPI. A handler therefore
 * cannot emit one shape while the generated contract advertises another.
 *
 * Facts still have exactly one mapper: `toRestFact` in the canonical query
 * layer. This package validates that mapper's result and adds no fields.
 */
import type { Entity, EntityRedirect } from '@data-foundry/canonical-schema';
import {
  assertNoReviewerIdentity,
  toRestFact,
  type CanonicalFactView,
  type ComparisonCell,
  type ComparisonRow,
  type EntityComparison,
  type EntityView,
  type FacetResult,
  type RedirectTrace,
  type RelationshipEdge,
  type RestFact,
  runtimeSchema as z,
  type RuntimeSchemaOutput,
  type SearchHit,
} from '@data-foundry/query-model';
import { jsonResponse, type ApiResponse } from './http.js';
import { PAGE_BOUNDS } from './pagination.js';

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
const nullableString = z.string().nullable();

export const EntityWireSchema = z.strictObject({
  id: uuid,
  verticalId: uuid,
  entityType: z.string(),
  canonicalName: z.string(),
  canonicalSlug: z.string(),
  status: z.string(),
  qualityScore: z.number().min(0).max(1),
  firstSeenAt: instant,
  lastVerifiedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
});
export type EntityWire = RuntimeSchemaOutput<typeof EntityWireSchema>;

export const RedirectHopWireSchema = z.strictObject({
  fromEntityId: uuid,
  toEntityId: uuid,
  fromSlug: nullableString,
  reason: z.string(),
  createdAt: instant,
});
export type RedirectHopWire = RuntimeSchemaOutput<typeof RedirectHopWireSchema>;

export const RedirectTraceWireSchema = z.strictObject({
  fromEntityId: uuid.nullable(),
  fromSlug: nullableString,
  reason: nullableString,
  hops: z.array(RedirectHopWireSchema),
});
export type RedirectTraceWire = RuntimeSchemaOutput<typeof RedirectTraceWireSchema>;

export const FactWireSchema = z.strictObject({
  property: z.string(),
  value: z.any(),
  valueType: nullableString,
  unit: nullableString,
  confidence: z.number().min(0).max(1).nullable(),
  factId: uuid.nullable(),
  rule: z.string(),
  reason: z.string(),
  sources: z.array(z.string()),
  unresolvedConflict: z.boolean(),
  editoriallyCorrected: z.boolean(),
  editorialCorrectionReason: nullableString,
  selectionWarnings: z.array(z.string()),
  verified: z.boolean().optional(),
});

export const SearchHitWireSchema = z.strictObject({
  entity: EntityWireSchema,
  matchKind: z.string(),
  score: z.number(),
  textRank: z.number(),
  exact: z.boolean(),
  matchedOn: nullableString,
  explain: z.string(),
});
export type SearchHitWire = RuntimeSchemaOutput<typeof SearchHitWireSchema>;

const FacetValueWireSchema = z.strictObject({
  value: z.string(),
  count: z.number().int().min(0),
});
const FacetRangeWireSchema = z.strictObject({ min: z.number(), max: z.number() });
export const FacetWireSchema = z.strictObject({
  property: z.string(),
  label: z.string(),
  control: z.string(),
  valueType: z.string(),
  unit: nullableString,
  values: z.array(FacetValueWireSchema),
  range: FacetRangeWireSchema.nullable(),
  entityCount: z.number().int().min(0),
});
export type FacetWire = RuntimeSchemaOutput<typeof FacetWireSchema>;

export const RelationshipEdgeWireSchema = z.strictObject({
  relationshipId: uuid,
  predicate: z.string(),
  direction: z.enum(['out', 'in']),
  fromEntityId: uuid,
  neighbor: EntityWireSchema,
  depth: z.number().int().min(1).max(4),
  evidenceCount: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  validFrom: instant,
  validTo: instant.nullable(),
});
export type RelationshipEdgeWire = RuntimeSchemaOutput<typeof RelationshipEdgeWireSchema>;

export const ComparisonCellWireSchema = z.strictObject({
  entityId: uuid,
  present: z.boolean(),
  value: z.any(),
  valueType: nullableString,
  unit: nullableString,
  rule: nullableString,
  sources: z.array(z.string()),
  unresolvedConflict: z.boolean(),
});
export type ComparisonCellWire = RuntimeSchemaOutput<typeof ComparisonCellWireSchema>;

export const ComparisonRowWireSchema = z.strictObject({
  property: z.string(),
  label: z.string(),
  unit: nullableString,
  differs: z.boolean(),
  cells: z.array(ComparisonCellWireSchema),
});
export type ComparisonRowWire = RuntimeSchemaOutput<typeof ComparisonRowWireSchema>;

export const ComparisonWireSchema = z.strictObject({
  entities: z.array(EntityWireSchema).min(2).max(8),
  rows: z.array(ComparisonRowWireSchema),
  propertiesCompared: z.number().int().min(0),
  propertiesDiffering: z.number().int().min(0),
});
export type ComparisonWire = RuntimeSchemaOutput<typeof ComparisonWireSchema>;

export const EntityViewWireSchema = z.strictObject({
  entity: EntityWireSchema,
  redirectedFrom: RedirectTraceWireSchema.nullable(),
});

export const PageMetaWireSchema = z.strictObject({
  limit: z.number().int().min(PAGE_BOUNDS.minLimit).max(PAGE_BOUNDS.maxLimit),
  offset: z.number().int().min(0).max(PAGE_BOUNDS.maxOffset),
  total: z.number().int().min(0),
  hasMore: z.boolean(),
});

export const RedirectResponseSchema = z.strictObject({
  redirect: z.strictObject({
    status: z.literal(301),
    location: z.string(),
    canonicalEntityId: uuid,
    redirectedFrom: RedirectTraceWireSchema,
  }),
});

export const ApiErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    status: z.number().int().min(400).max(599),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().max(64).optional(),
  }),
});

export const OpaqueEdgeErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(['UNAUTHORIZED', 'FORBIDDEN', 'SERVICE_UNAVAILABLE']),
    message: z.string(),
  }),
});

export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  version: z.literal('v1'),
  verticalId: uuid,
  declaredFields: z.number().int().min(0),
  checks: z.strictObject({ queryLayer: z.literal('ok') }),
});

export const EntityResponseSchema = z.strictObject({ data: EntityViewWireSchema });

export const FactPageResponseSchema = z.strictObject({
  entityId: uuid,
  data: z.array(FactWireSchema),
  page: PageMetaWireSchema,
});

export const RelationshipPageResponseSchema = z.strictObject({
  entityId: uuid,
  traversal: z.strictObject({
    depth: z.number().int().min(1).max(4),
    direction: z.enum(['out', 'in', 'both']),
    edgeBound: z.number().int().min(1),
    boundReached: z.boolean(),
    unevidencedEdgeCount: z.number().int().min(0),
  }),
  data: z.array(RelationshipEdgeWireSchema),
  page: PageMetaWireSchema,
});

export const SearchResponseSchema = z.strictObject({
  data: z.array(SearchHitWireSchema),
  page: PageMetaWireSchema,
  match: z.strictObject({
    exactShortCircuit: z.boolean(),
    exactCount: z.number().int().min(0),
  }),
  strategy: z.strictObject({
    exactFirst: z.boolean(),
    fullText: z.boolean(),
    trigram: z.boolean(),
    vector: z.boolean(),
  }),
  facets: z.array(FacetWireSchema),
});

export const CompareResponseSchema = z.strictObject({
  data: ComparisonWireSchema,
  redirects: z.array(z.strictObject({ requestedId: uuid, canonicalEntityId: uuid })),
});

/** Every component emitted into OpenAPI, all executable at the REST boundary. */
export const WIRE_COMPONENT_SCHEMAS = {
  ApiErrorEnvelope: ApiErrorEnvelopeSchema,
  OpaqueEdgeErrorEnvelope: OpaqueEdgeErrorEnvelopeSchema,
  PageMeta: PageMetaWireSchema,
  Entity: EntityWireSchema,
  RedirectHop: RedirectHopWireSchema,
  RedirectTrace: RedirectTraceWireSchema,
  RedirectResponse: RedirectResponseSchema,
  EntityView: EntityViewWireSchema,
  Fact: FactWireSchema,
  RelationshipEdge: RelationshipEdgeWireSchema,
  SearchHit: SearchHitWireSchema,
  Facet: FacetWireSchema,
  Comparison: ComparisonWireSchema,
  HealthResponse: HealthResponseSchema,
  EntityResponse: EntityResponseSchema,
  FactPageResponse: FactPageResponseSchema,
  RelationshipPageResponse: RelationshipPageResponseSchema,
  SearchResponse: SearchResponseSchema,
  CompareResponse: CompareResponseSchema,
} as const;

export const OPENAPI_RESPONSE_SCHEMA_NAMES = [
  'HealthResponse',
  'EntityResponse',
  'FactPageResponse',
  'RelationshipPageResponse',
  'SearchResponse',
  'CompareResponse',
] as const;
export type OpenApiResponseSchemaName = (typeof OPENAPI_RESPONSE_SCHEMA_NAMES)[number];
export type WireComponentSchemaName = keyof typeof WIRE_COMPONENT_SCHEMAS;

/** Runtime parser shared by route serialization and contract-level tests. */
export function parseWireResponse(name: WireComponentSchemaName, value: unknown): unknown {
  return WIRE_COMPONENT_SCHEMAS[name].parse(value);
}

/** Serialize only after the named runtime response contract accepts the body. */
export function wireJsonResponse(
  schema: OpenApiResponseSchemaName | 'RedirectResponse',
  status: number,
  body: unknown,
  version: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): ApiResponse {
  return jsonResponse(status, parseWireResponse(schema, body), version, extraHeaders);
}

export function entityWire(entity: Entity): EntityWire {
  return EntityWireSchema.parse({
    id: entity.id,
    verticalId: entity.vertical_id,
    entityType: entity.entity_type,
    canonicalName: entity.canonical_name,
    canonicalSlug: entity.canonical_slug,
    status: entity.status,
    qualityScore: entity.quality_score,
    firstSeenAt: entity.first_seen_at,
    lastVerifiedAt: entity.last_verified_at,
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
  });
}

const hopWire = (hop: EntityRedirect): RedirectHopWire => RedirectHopWireSchema.parse({
  fromEntityId: hop.from_entity_id,
  toEntityId: hop.to_entity_id,
  fromSlug: hop.from_slug,
  reason: hop.reason,
  createdAt: hop.created_at,
});

export function redirectTraceWire(trace: RedirectTrace): RedirectTraceWire {
  return RedirectTraceWireSchema.parse({
    fromEntityId: trace.from_entity_id,
    fromSlug: trace.from_slug,
    reason: trace.reason,
    hops: trace.hops.map(hopWire),
  });
}

/** The shared query-layer fact mapper, followed only by validation/privacy gates. */
export function factWire(view: CanonicalFactView, reviewers: readonly string[]): RestFact {
  const wire = toRestFact(view);
  FactWireSchema.parse(wire);
  assertNoReviewerIdentity(wire, reviewers);
  return wire;
}

export function searchHitWire(hit: SearchHit): SearchHitWire {
  return SearchHitWireSchema.parse({
    entity: entityWire(hit.entity),
    matchKind: hit.match_kind,
    score: hit.score,
    textRank: hit.text_rank,
    exact: hit.exact,
    matchedOn: hit.matched_on,
    explain: hit.explain,
  });
}

export function facetWire(facet: FacetResult): FacetWire {
  return FacetWireSchema.parse({
    property: facet.property,
    label: facet.label,
    control: facet.control,
    valueType: facet.value_type,
    unit: facet.unit,
    values: facet.values.map((value) => ({ value: value.value, count: value.count })),
    range: facet.range,
    entityCount: facet.entity_count,
  });
}

export function relationshipEdgeWire(edge: RelationshipEdge): RelationshipEdgeWire {
  return RelationshipEdgeWireSchema.parse({
    relationshipId: edge.relationship.id,
    predicate: edge.relationship.predicate,
    direction: edge.direction,
    fromEntityId: edge.from_entity_id,
    neighbor: entityWire(edge.neighbor),
    depth: edge.depth,
    evidenceCount: edge.evidence_count,
    confidence: edge.relationship.confidence,
    validFrom: edge.relationship.valid_from,
    validTo: edge.relationship.valid_to,
  });
}

const cellWire = (cell: ComparisonCell): ComparisonCellWire => ComparisonCellWireSchema.parse({
  entityId: cell.entity_id,
  present: cell.present,
  value: cell.value,
  valueType: cell.value_type,
  unit: cell.unit,
  rule: cell.rule,
  sources: [...cell.sources],
  unresolvedConflict: cell.unresolved_conflict,
});

const rowWire = (row: ComparisonRow): ComparisonRowWire => ComparisonRowWireSchema.parse({
  property: row.property,
  label: row.label,
  unit: row.unit,
  differs: row.differs,
  cells: row.cells.map(cellWire),
});

export function comparisonWire(comparison: EntityComparison): ComparisonWire {
  return ComparisonWireSchema.parse({
    entities: comparison.entities.map(entityWire),
    rows: comparison.rows.map(rowWire),
    propertiesCompared: comparison.properties_compared,
    propertiesDiffering: comparison.properties_differing,
  });
}

export function entityViewWire(view: EntityView): RuntimeSchemaOutput<typeof EntityViewWireSchema> {
  return EntityViewWireSchema.parse({
    entity: entityWire(view.entity),
    redirectedFrom: view.redirected_from === null ? null : redirectTraceWire(view.redirected_from),
  });
}
