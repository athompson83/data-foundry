/**
 * The tool contract.
 *
 * SIX tools. AGENTS.md scope control forbids "dozens of MCP tools" and every
 * vertical's `mcp.yaml` repeats the target: keep the set small and
 * intent-oriented. Two of these resolve a question to an entity
 * (`search_entities`, `get_entity`); the other four answer a question about an
 * entity already resolved, and take a canonical id rather than re-running
 * resolution six different ways.
 *
 * Descriptions are agent SEO (doc 07): each states the intent served, the
 * identifiers accepted, what the output means, the citation behaviour, and —
 * the part that actually changes behaviour — what the tool cannot do, so a
 * model stops calling it for the wrong reason.
 *
 * THE SCHEMA IS THE GATE. `defineTool` parses arguments with the tool's own
 * `input` schema before the handler runs, and publishes `inputSchema` by
 * generating JSON Schema from that same object. A handler cannot be reached
 * with arguments the published schema rejects, and the published schema cannot
 * describe constraints the validator does not apply, because there is only one
 * object.
 *
 * NOTHING HERE TOUCHES ANYTHING BELOW THE QUERY LAYER. No SQL, no store, no
 * fact selection, no ranking, no redirect following. Where a query-layer call
 * would be inconvenient the answer is to add it there, not to reach past it.
 */
import type { z } from 'zod';
import {
  McpToolError,
  entityNotFound,
  invalidArguments,
  type ArgumentIssue,
  type McpToolErrorCode,
} from './errors.js';
import {
  assertPayloadCarriesNoReviewer,
  assertPayloadCarriesNoWithheldSource,
  guardCorrectionFields,
  reviewerTokens as reviewerTokensFor,
  reviewersIn,
} from './guard.js';
import {
  UnknownFieldError,
  identifierCandidates,
  type CanonicalFactView,
  type EntityView,
  type FacetFilter,
  type FactExplanation,
  type FactSelectionPolicy,
  type QueryModel,
  type SearchQuery,
  type VerticalId,
} from './query-layer.js';
import {
  comparison,
  explanation,
  factSheet,
  withheldSourceTokens,
  entityRef,
  redirectNotice,
  searchResult,
  traversal,
  type CanonicalUrlBuilder,
  type CompareEntitiesResult,
  type EntityResolution,
  type ExplainFactResult,
  type FactSheet,
  type GetEntityResult,
  type ListFactsResult,
  type RequestedEntity,
  type SearchEntitiesResult,
  type TraverseRelationshipsResult,
} from './projection.js';
import {
  CompareEntitiesInput,
  ExplainFactInput,
  GetEntityInput,
  ListFactsInput,
  SearchEntitiesInput,
  TraverseRelationshipsInput,
  publishInputSchema,
  type JsonSchemaDocument,
} from './schemas.js';

/** Everything a handler is given. Note what is absent: a store, a driver, SQL. */
export interface ToolContext {
  readonly queryModel: QueryModel;
  readonly vertical: { readonly id: VerticalId; readonly slug: string };
  /**
   * Server-side fact-selection policy. NOT caller-controllable: it carries
   * `editorialOverrides`, and a tool argument that could set one would let an
   * agent publish a correction nobody reviewed. The only selection input a
   * caller may supply is `as_of`, which moves the read instant and nothing else.
   */
  readonly policy: FactSelectionPolicy;
  readonly canonicalUrl: CanonicalUrlBuilder;
}

/**
 * A handler's answer, plus the reviewer tokens the dispatcher must sweep it
 * for. Returning the tokens rather than running the sweep inside each handler
 * means a new tool cannot forget to be swept — the dispatcher does it.
 */
export interface Guarded<T> {
  readonly result: T;
  /** Reviewer identities the dispatcher must sweep this payload for. */
  readonly reviewerTokens: readonly string[];
  /** Publishers/domains/artifacts of sources that failed the publish gate. */
  readonly withheldSourceTokens: readonly string[];
}

const unguarded = <T,>(result: T): Guarded<T> => ({
  result,
  reviewerTokens: [],
  withheldSourceTokens: [],
});

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  /** JSON Schema, generated from the validator below. Never hand-written. */
  readonly inputSchema: JsonSchemaDocument;
  /** The validator. Exposed so tests can prove the two are the same object. */
  readonly input: z.ZodType;
  readonly errors: readonly McpToolErrorCode[];
  /** Validates, then runs. Unreachable without a successful parse. */
  readonly invoke: (context: ToolContext, args: unknown) => Promise<Guarded<unknown>>;
}

const issuesOf = (error: z.ZodError): ArgumentIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.map((part) => String(part)).join('.'),
    code: issue.code,
    message: issue.message,
  }));

function defineTool<S extends z.ZodType>(spec: {
  readonly name: string;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly input: S;
  readonly errors: readonly McpToolErrorCode[];
  readonly handler: (context: ToolContext, args: z.infer<S>) => Promise<Guarded<unknown>>;
}): ToolDefinition {
  return {
    name: spec.name,
    title: spec.title,
    summary: spec.summary,
    description: spec.description,
    input: spec.input,
    inputSchema: publishInputSchema(spec.input),
    errors: spec.errors,
    invoke: async (context, args) => {
      const parsed = spec.input.safeParse(args ?? {});
      if (!parsed.success) throw invalidArguments(spec.name, issuesOf(parsed.error));
      return spec.handler(context, parsed.data as z.infer<S>);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Shared handler helpers
 * ------------------------------------------------------------------ */

/** A call's read instant, and the policy that carries it down every read. */
interface ReadAt {
  /** The server policy with this call's instant pinned onto it. */
  readonly policy: FactSelectionPolicy;
  /** The same instant, for the answer to report. */
  readonly instant: string;
}

/**
 * Resolve the instant this call is answered as of — ONCE, before any read.
 *
 * Facts are versioned and every selection is evaluated as of a moment (doc 04),
 * so the instant is part of the answer, not decoration. It used to be taken
 * wherever it was needed: the fact sheet was selected at whatever instant the
 * query layer read when it found no `at` on the policy, and the `asOf` beside
 * it came from a LATER call to the clock here. The two differed by however long
 * the query took, so a response said a value was current as of an instant at
 * which the catalogue was never consulted — and an agent re-running the call
 * with the reported `asOf`, which is how an answer gets reproduced, could get a
 * different one with nothing in either payload explaining the difference. The
 * refusal for an unrecorded property managed to disagree with ITSELF, naming
 * one instant in its prose and another in its details.
 *
 * Pinning it onto the policy is what makes this structural rather than careful:
 * every layer below reads `policy.at` and none of them reaches for a clock,
 * because the policy already has an instant on it.
 */
function readAt(context: ToolContext, asOf?: string): ReadAt {
  const instant = asOf ?? context.policy.at ?? new Date().toISOString();
  return { policy: { ...context.policy, at: instant }, instant };
}

/**
 * Fetch by canonical id, refusing ids belonging to another vertical.
 *
 * One server serves one vertical (`mcp.yaml`: `server.vertical`). Without this
 * check a caller holding an id from a neighbouring vertical would read it
 * here, which is a tenancy leak dressed as a successful lookup.
 */
async function requireEntity(context: ToolContext, entityId: string): Promise<EntityView> {
  const view = await context.queryModel.getEntity(entityId as never);
  if (view === null || view.entity.vertical_id !== context.vertical.id) {
    throw entityNotFound(
      { entity_id: entityId, vertical: context.vertical.slug },
      `No entity with that id exists in the "${context.vertical.slug}" vertical.`,
    );
  }
  return view;
}

/**
 * The canonical fact sheet, rights-gated and reviewer-guarded.
 *
 * READS `canonicalFacts`, NOT `facts`. `QueryModel.facts()` returns stored fact
 * versions with their evidence chains and does not run the doc-04 selection
 * cascade — so it does not apply the rule-1 rights gate, and a claim backed
 * only by an UNREVIEWED source comes back from it intact. That call is right
 * for a provenance surface and wrong for this one. `canonicalFacts` is the
 * selected, gated view every consumer of the query layer shares.
 */
async function readFactSheet(
  context: ToolContext,
  entityId: string,
  policy: FactSelectionPolicy,
  properties?: readonly string[],
): Promise<Guarded<FactSheet>> {
  const all = await context.queryModel.canonicalFacts(entityId as never, policy);
  const views =
    properties === undefined
      ? all
      : all.filter((view: CanonicalFactView) => properties.includes(view.property));

  const sheet = factSheet(views);

  // Reviewer names are only in play where a correction was applied, and the
  // only way to learn them is `explainFact` — the internal surface. Asking for
  // them unconditionally would double the query count of every fact read to
  // guard against a state that is usually absent.
  const corrected = views.filter((view: CanonicalFactView) => view.editorially_corrected);
  if (corrected.length === 0) return unguarded(sheet);

  const explanations: FactExplanation[] = [];
  for (const view of corrected) {
    const found = await context.queryModel.explainFact(entityId as never, view.property, policy);
    if (found !== null) explanations.push(found);
  }
  const reviewers = reviewersIn(explanations);

  // Layer 1 of the control, per fact, using the query layer's own assertion.
  for (const fact of sheet.facts) {
    guardCorrectionFields(
      {
        editoriallyCorrected: fact.editoriallyCorrected,
        editorialCorrectionReason: fact.editorialCorrectionReason,
        selectionWarnings: fact.selectionWarnings,
      },
      reviewers,
    );
  }

  return {
    result: sheet,
    reviewerTokens: reviewerTokensFor(reviewers),
    withheldSourceTokens: [],
  };
}

/* ------------------------------------------------------------------ *
 * search_entities
 * ------------------------------------------------------------------ */

const searchEntities = defineTool({
  name: 'search_entities',
  title: 'Search the catalogue',
  summary: 'Find entities by identifier or description.',
  description:
    'Find canonical entities in this vertical by an exact identifier in any formatting (model ' +
    'number, SKU, part number, certification reference), by a name or description, or by ' +
    'declared field filters alone. AN EXACT IDENTIFIER MATCH IS RETURNED AHEAD OF EVERY RANKED ' +
    'TEXT MATCH, always: exactness is a separate tier evaluated before ranking, not a bonus ' +
    'added to a score, so a textually better-scoring near-namesake cannot displace the unit ' +
    'whose part number you typed. Each hit reports why it matched (`matchKind`, `matchedOn`) ' +
    'and both its ordering score and its purely textual rank, so the ordering can be checked ' +
    'rather than trusted. Returns canonical ids to pass to the other tools, plus optional facet ' +
    'counts. LIMITATIONS: there is no vector or semantic search here by design — a query that ' +
    'describes a thing without naming it will match only on indexed text, never on meaning. ' +
    'Filters are rejected, not ignored, when the field is not declared filterable for this ' +
    'vertical. Returns entities, never fact values: read those with get_entity or list_facts.',
  input: SearchEntitiesInput,
  errors: ['INVALID_ARGUMENTS', 'UNKNOWN_FIELD', 'INTERNAL_ERROR'],
  handler: async (context, args): Promise<Guarded<SearchEntitiesResult>> => {
    const text = args.query?.trim() ?? '';
    const query: SearchQuery = {
      vertical_id: context.vertical.id,
      statuses: args.include_retired ? ['ACTIVE', 'RETIRED'] : ['ACTIVE'],
      limit: args.limit,
      offset: args.offset,
      include_facets: args.include_facets,
      ...(text === '' ? {} : { text }),
      ...(args.entity_type === undefined ? {} : { entity_type: args.entity_type }),
      ...(args.filters === undefined ? {} : { filters: args.filters as readonly FacetFilter[] }),
    };

    try {
      const found = await context.queryModel.search(query);
      return unguarded(
        searchResult(context.vertical.slug, text === '' ? null : text, found, context.canonicalUrl),
      );
    } catch (error: unknown) {
      // The query layer refuses a filter on an undeclared or non-filterable
      // field rather than dropping it silently. Repeat that refusal as a code
      // the caller can act on instead of letting it surface as a stack.
      if (error instanceof UnknownFieldError) {
        throw new McpToolError(
          'UNKNOWN_FIELD',
          `"${error.field}" is not a filterable field in the "${context.vertical.slug}" vertical. ` +
            'Filters are rejected rather than ignored, so this search returned nothing at all ' +
            'instead of quietly returning unfiltered results.',
          { field: error.field, vertical: context.vertical.slug },
        );
      }
      throw error;
    }
  },
});

/* ------------------------------------------------------------------ *
 * get_entity
 * ------------------------------------------------------------------ */

const UUID_SHAPED = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const getEntity = defineTool({
  name: 'get_entity',
  title: 'Resolve an identifier to a canonical entity',
  summary: 'What is this thing, and what do we publish about it?',
  description:
    'Resolve one identifier — a canonical entity id, a canonical slug, or any recorded ' +
    'identifier or alias in any casing or separator style — to the single canonical entity it ' +
    'names, and return the published fact sheet for it. Matching is DETERMINISTIC: an alias is ' +
    'matched on its normalized form, never on resemblance, so a returned match is an exact ' +
    'match and an unknown identifier is reported as unknown rather than answered with the ' +
    'closest-looking entity. An identifier that matches more than one entity returns the ' +
    'candidates instead of a guess. Follows merge/rename redirects, so an id or URL saved before ' +
    'a merge still resolves and the response says it was redirected. Every returned fact carries ' +
    'its selecting rule, its publishers, whether an editorial correction replaced the ' +
    'source-selected value and why, and any trust warnings about how it was selected. ' +
    'LIMITATIONS: resolves within one vertical only; will not guess from a partial fragment; ' +
    'and a property backed only by sources that fail the publish gate is reported in ' +
    '`withheldFacts` with the reason, never as a value.',
  input: GetEntityInput,
  errors: [
    'INVALID_ARGUMENTS',
    'ENTITY_NOT_FOUND',
    'AMBIGUOUS_IDENTIFIER',
    'REVIEWER_IDENTITY_BLOCKED',
    'INTERNAL_ERROR',
  ],
  handler: async (context, args): Promise<Guarded<GetEntityResult>> => {
    const resolved = await resolveIdentifier(context, args.identifier, args.entity_type);
    const read = readAt(context);

    if (!args.include_facts) {
      return unguarded({
        entity: entityRef(resolved.view.entity, context.canonicalUrl),
        resolvedBy: resolved.resolvedBy,
        matchedOn: resolved.matchedOn,
        redirectedFrom: redirectNotice(resolved.view),
        asOf: read.instant,
        facts: null,
        withheldFacts: null,
        trust: null,
      });
    }

    const sheet = await readFactSheet(context, resolved.view.entity.id, read.policy);
    return {
      result: {
        entity: entityRef(resolved.view.entity, context.canonicalUrl),
        resolvedBy: resolved.resolvedBy,
        matchedOn: resolved.matchedOn,
        redirectedFrom: redirectNotice(resolved.view),
        asOf: read.instant,
        facts: sheet.result.facts,
        withheldFacts: sheet.result.withheldFacts,
        trust: sheet.result.trust,
      },
      reviewerTokens: sheet.reviewerTokens,
      withheldSourceTokens: sheet.withheldSourceTokens,
    };
  },
});

interface ResolvedEntity {
  readonly view: EntityView;
  readonly resolvedBy: EntityResolution;
  readonly matchedOn: string | null;
}

/**
 * Identifier → entity, in one fixed deterministic order: canonical id, then
 * exact alias, then slug.
 *
 * AGENTS.md rule 7 lives here as an absence: there is no fourth step. If none
 * of the three exact probes matches, this reports that nothing matched and
 * includes the normalized forms it tried, so the caller can see how the input
 * was read. It does not fall back to search, because a fuzzy fallback behind an
 * exact lookup is precisely a similarity match outranking "no exact hit".
 */
async function resolveIdentifier(
  context: ToolContext,
  identifier: string,
  entityType: string | undefined,
): Promise<ResolvedEntity> {
  const raw = identifier.trim();

  if (UUID_SHAPED.test(raw)) {
    const view = await context.queryModel.getEntity(raw as never);
    if (view !== null && view.entity.vertical_id === context.vertical.id) {
      return { view, resolvedBy: 'entity_id', matchedOn: raw };
    }
  }

  const lookup = await context.queryModel.lookupIdentifier({
    vertical_id: context.vertical.id,
    value: raw,
    ...(entityType === undefined ? {} : { entity_type: entityType }),
  });

  if (lookup.entities.length === 1) {
    const view = lookup.entities[0] as EntityView;
    return {
      view,
      resolvedBy: 'identifier',
      matchedOn: lookup.matches[0]?.alias.alias_value ?? raw,
    };
  }
  if (lookup.entities.length > 1) {
    throw new McpToolError(
      'AMBIGUOUS_IDENTIFIER',
      `"${raw}" matches ${String(lookup.entities.length)} entities in the ` +
        `"${context.vertical.slug}" vertical. The candidates are returned rather than a guess; ` +
        'narrow with entity_type, or call get_entity again with one of the canonical ids.',
      {
        identifier: raw,
        candidates: lookup.entities.map((view) => ({
          entity_id: view.entity.id,
          entity_type: view.entity.entity_type,
          name: view.entity.canonical_name,
          slug: view.entity.canonical_slug,
        })),
      },
    );
  }

  if (entityType !== undefined) {
    const bySlug = await context.queryModel.getEntityBySlug(
      context.vertical.id,
      entityType,
      raw as never,
    );
    if (bySlug !== null) return { view: bySlug, resolvedBy: 'slug', matchedOn: raw };
  }

  throw entityNotFound(
    {
      identifier: raw,
      vertical: context.vertical.slug,
      ...(entityType === undefined ? {} : { entity_type: entityType }),
      // How the input was read, so a caller can see whether the normalization
      // — not the catalogue — is what failed them.
      normalized_forms_tried: identifierCandidates(raw),
    },
    `Nothing in the "${context.vertical.slug}" vertical carries that identifier. Matching is ` +
      'exact on normalized identifiers, so this means the catalogue does not hold it — not that ' +
      'a near match was rejected. Use search_entities for a text query.',
  );
}

/* ------------------------------------------------------------------ *
 * list_facts
 * ------------------------------------------------------------------ */

const listFacts = defineTool({
  name: 'list_facts',
  title: 'Read the published fact sheet',
  summary: 'What do we publish about this entity, and how sure are we?',
  description:
    'Return the canonical published facts for one entity by canonical id — optionally narrowed ' +
    'to named properties, and optionally as the sheet stood at an earlier instant. Each fact ' +
    'carries its normalized value and unit, its confidence, the publishers behind it, the ' +
    'selection rule that chose it and why, whether rival claims are still unresolved, whether an ' +
    'editorial correction replaced the source-selected value together with the ' +
    'customer-visible reason, and machine-readable selection warnings (ignore codes you do not ' +
    'recognise; the list is designed to grow). Properties the platform holds claims about but ' +
    'publishes nothing for are listed separately in `withheldFacts` with the reason — a claim ' +
    'with no evidence, or backed only by sources that fail the rights gate, is never returned ' +
    'as a value. LIMITATIONS: takes a canonical id, not a model number — resolve one with ' +
    'get_entity first. Returns the selected value per property, not the full evidence trail: ' +
    'call explain_fact for that. It does not compute or infer values.',
  input: ListFactsInput,
  errors: [
    'INVALID_ARGUMENTS',
    'ENTITY_NOT_FOUND',
    'REVIEWER_IDENTITY_BLOCKED',
    'INTERNAL_ERROR',
  ],
  handler: async (context, args): Promise<Guarded<ListFactsResult>> => {
    const view = await requireEntity(context, args.entity_id);
    const read = readAt(context, args.as_of);
    const sheet = await readFactSheet(context, view.entity.id, read.policy, args.properties);

    return {
      result: {
        entity: entityRef(view.entity, context.canonicalUrl),
        asOf: read.instant,
        properties: args.properties === undefined ? null : [...args.properties],
        facts: sheet.result.facts,
        withheldFacts: sheet.result.withheldFacts,
        trust: sheet.result.trust,
      },
      reviewerTokens: sheet.reviewerTokens,
      withheldSourceTokens: sheet.withheldSourceTokens,
    };
  },
});

/* ------------------------------------------------------------------ *
 * compare_entities
 * ------------------------------------------------------------------ */

const compareEntities = defineTool({
  name: 'compare_entities',
  title: 'Compare entities side by side',
  summary: 'How do these differ?',
  description:
    'Compare two to five entities by canonical id across every property any of them holds, or ' +
    'across named properties only. Rows are ordered by the vertical’s own declared field ' +
    'order, and each row says whether the entities differ; each cell says whether the property ' +
    'is PRESENT for that entity, which is a different statement from the values being equal. ' +
    'Every cell carries the publishers and the selection rule behind its value, so a difference ' +
    'can be checked rather than trusted, and any id that resolved to nothing is reported in ' +
    '`unresolvedEntityIds` so a partial comparison is legible as partial. LIMITATIONS: compares ' +
    'published values only. It does not judge which entity is better, does not assess ' +
    'suitability for any particular use, and never infers a missing value from a similar ' +
    'entity — missing is reported as missing.',
  input: CompareEntitiesInput,
  errors: [
    'INVALID_ARGUMENTS',
    'ENTITY_NOT_FOUND',
    'TOO_FEW_ENTITIES',
    'INTERNAL_ERROR',
  ],
  handler: async (context, args): Promise<Guarded<CompareEntitiesResult>> => {
    // Scope every id to this server's vertical before comparing. `compare`
    // itself silently skips ids it cannot load, which would turn a
    // cross-vertical id into a quietly shorter table.
    //
    // The pairing is kept, not just the ids that survived it: `getEntity`
    // follows merge redirects, so an id the caller saved before a merge
    // resolves to a DIFFERENT canonical id, and only this loop knows which
    // requested id each compared entity came from.
    const requested: RequestedEntity[] = [];
    for (const id of args.entity_ids) {
      const view = await context.queryModel.getEntity(id as never);
      const scoped = view !== null && view.entity.vertical_id === context.vertical.id;
      requested.push({ requestedId: id, resolvedId: scoped ? view.entity.id : null });
    }

    const resolved = requested.flatMap((entity) =>
      entity.resolvedId === null ? [] : [entity.resolvedId],
    );

    if (resolved.length < 2) {
      throw new McpToolError(
        'TOO_FEW_ENTITIES',
        `Comparison needs at least two entities that exist in the "${context.vertical.slug}" ` +
          `vertical; ${String(resolved.length)} of ${String(args.entity_ids.length)} resolved.`,
        {
          resolved,
          unresolved: requested
            .filter((entity) => entity.resolvedId === null)
            .map((entity) => entity.requestedId),
          vertical: context.vertical.slug,
        },
      );
    }

    // One instant for the whole table. `compare` selects a fact sheet per
    // entity, and each of those selections takes its own instant when the
    // policy carries none — so the columns would be as of different moments,
    // in a response with no `asOf` field for that to be visible in.
    const result = await context.queryModel.compare({
      entity_ids: resolved as never,
      policy: readAt(context).policy,
      ...(args.properties === undefined ? {} : { properties: args.properties }),
    });

    return unguarded(comparison(result, requested, context.canonicalUrl));
  },
});

/* ------------------------------------------------------------------ *
 * traverse_relationships
 * ------------------------------------------------------------------ */

const traverseRelationships = defineTool({
  name: 'traverse_relationships',
  title: 'Follow canonical relationships',
  summary: 'What is this connected to — and what replaces it?',
  description:
    'Walk the canonical relationship graph out from one entity: optionally restricted to a ' +
    'single declared predicate, in either or both directions, up to four hops. This is the tool ' +
    'for chain questions — what replaced a discontinued item, what a thing is part of, what ' +
    'certifies it — because a one-hop answer to a multi-hop chain is wrong in a way that looks ' +
    'right. Every edge reports its predicate, direction, hop depth, the neighbouring entity, the ' +
    'recorded confidence and how many pieces of evidence back it; `truncated` says when the ' +
    'limit stopped the walk short. LIMITATIONS: an edge exists only where a source asserted it. ' +
    'Nothing here is inferred from similarity, so an entity with no asserted successor returns ' +
    'no successor rather than a plausible one. Depth is capped at four by design. Edges backed ' +
    'by no publishable evidence — none at all, or only sources that fail the rights gate — are ' +
    'withheld and counted in `withheldEdgeCount`, never returned as facts; so is any neighbour ' +
    'reachable only through one, which is why a walk can stop short of a node the graph holds.',
  input: TraverseRelationshipsInput,
  errors: ['INVALID_ARGUMENTS', 'ENTITY_NOT_FOUND', 'INTERNAL_ERROR'],
  handler: async (context, args): Promise<Guarded<TraverseRelationshipsResult>> => {
    const view = await requireEntity(context, args.entity_id);
    const found = await context.queryModel.relationships({
      entity_id: view.entity.id,
      direction: args.direction,
      depth: args.depth,
      limit: args.limit,
      ...(args.predicate === undefined ? {} : { predicate: args.predicate }),
    });
    return unguarded(traversal(view.entity, found, context.canonicalUrl));
  },
});

/* ------------------------------------------------------------------ *
 * explain_fact
 * ------------------------------------------------------------------ */

const explainFact = defineTool({
  name: 'explain_fact',
  title: 'Show the evidence behind one value',
  summary: 'Why does the catalogue say this?',
  description:
    'Show the complete evidence trail behind one property of one entity: every publishable ' +
    'source that made a claim, the value each published, the exact location inside the source ' +
    'document, when it was observed, which claim was selected as canonical, and WHICH SELECTION ' +
    'RULE decided it. Losing claims are returned too — conflicting claims are retained, never ' +
    'overwritten, and the disagreement between a certified figure and a brochure figure is ' +
    'often the answer the user actually needs. This is the tool for "why does your value differ ' +
    'from the one I have?". Where an editorial correction replaced the source-selected value, ' +
    'that is stated together with its customer-visible reason. LIMITATIONS: covers only claims ' +
    'that reached canonical storage. Claims backed solely by sources failing the rights gate are ' +
    'withheld and counted, not shown. The identity of the staff reviewer behind an editorial ' +
    'correction is never returned by this or any other tool — the reason is publishable, the ' +
    'reviewer is not.',
  input: ExplainFactInput,
  errors: [
    'INVALID_ARGUMENTS',
    'ENTITY_NOT_FOUND',
    'PROPERTY_NOT_RECORDED',
    'REVIEWER_IDENTITY_BLOCKED',
    'UNPUBLISHABLE_SOURCE_BLOCKED',
    'INTERNAL_ERROR',
  ],
  handler: async (context, args): Promise<Guarded<ExplainFactResult>> => {
    const view = await requireEntity(context, args.entity_id);
    const read = readAt(context, args.as_of);
    const found = await context.queryModel.explainFact(view.entity.id, args.property, read.policy);

    if (found === null) {
      throw entityNotFound({ entity_id: args.entity_id, vertical: context.vertical.slug });
    }
    if (found.claims.length === 0) {
      throw new McpToolError(
        'PROPERTY_NOT_RECORDED',
        `"${view.entity.canonical_name}" exists, but no source in this catalogue publishes ` +
          `"${args.property}" for it at ${read.instant}. That is a coverage gap, not a ` +
          'rejected value — nothing was excluded, there was nothing to exclude.',
        {
          entity_id: view.entity.id,
          property: args.property,
          as_of: read.instant,
        },
      );
    }

    const reviewers = reviewersIn([found]);
    const tokens = reviewerTokensFor(reviewers);
    const sourceTokens = withheldSourceTokens(found);
    const result = explanation(found, tokens, sourceTokens);

    // Layer 1, on the one field that carries a correction's prose.
    guardCorrectionFields(
      {
        editoriallyCorrected: result.editoriallyCorrected,
        editorialCorrectionReason: result.editorialCorrectionReason,
        selectionWarnings: result.selectionWarnings,
      },
      reviewers,
    );

    return { result, reviewerTokens: tokens, withheldSourceTokens: sourceTokens };
  },
});

/* ------------------------------------------------------------------ *
 * The set
 * ------------------------------------------------------------------ */

export const TOOLS: readonly ToolDefinition[] = [
  searchEntities,
  getEntity,
  listFacts,
  compareEntities,
  traverseRelationships,
  explainFact,
] as const;

export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);

/** Re-exported so the dispatcher applies layer 2 without importing the guard. */
export { assertPayloadCarriesNoReviewer, assertPayloadCarriesNoWithheldSource };
