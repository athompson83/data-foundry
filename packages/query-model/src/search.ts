/**
 * Search — Postgres full-text and trigram, with an exact-identifier
 * short-circuit in front of all of it.
 *
 * AGENTS.md rule 7 and doc 02 both say the same thing: **exact identifiers must
 * always win over semantic/fuzzy similarity.** That is implemented here as
 * structure, not as scoring. Two queries run: a deterministic equality probe
 * against `current_entity_aliases`, `canonical_slug` and `canonical_name`, and a
 * ranked text query. Exact hits are placed ahead of every ranked hit before any
 * comparison of scores happens, so a fuzzier candidate that ranks higher
 * textually still cannot displace an exact model-number match.
 *
 * Both a hit's `score` and its `text_rank` are returned, so this behaviour is
 * observable rather than asserted: a caller can see that the runner-up outranked
 * the winner textually and lost anyway.
 *
 * There is no vector search here, by design (doc 02: "Vector search is optional
 * and should support semantic discovery, not replace exact identifiers").
 */
import {
  ENTITY_COLUMNS,
  mapEntity,
  supportsTrigram,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import type { Entity, EntityStatus, Identifier, VerticalId } from '@data-foundry/canonical-schema';
import { computeFacets, facetFilterPredicates } from './filters.js';
import type { FacetFilter, FacetResult, FieldMetadataRegistry } from './field-metadata.js';
import { CURRENT_FACT, Params, VALUE_TEXT, identifierCandidates, likePattern } from './sql.js';

export const SEARCH_MATCH_KINDS = [
  /** Equality on an alias/identifier. Always ranked first. */
  'EXACT_IDENTIFIER',
  'EXACT_SLUG',
  'EXACT_NAME',
  'FULL_TEXT',
  'TRIGRAM',
  'SUBSTRING',
  /** Matched the value of a `search_boost`-weighted field. */
  'FIELD_VALUE',
  /** No text query; the entity satisfied the filters. */
  'FILTER_ONLY',
] as const;
export type SearchMatchKind = (typeof SEARCH_MATCH_KINDS)[number];

export interface SearchQuery {
  readonly vertical_id: VerticalId;
  readonly text?: string;
  readonly entity_type?: Identifier;
  readonly filters?: readonly FacetFilter[];
  readonly statuses?: readonly EntityStatus[];
  readonly limit?: number;
  readonly offset?: number;
  readonly include_facets?: boolean;
  /** Minimum trigram similarity, when pg_trgm is available. */
  readonly fuzzy_threshold?: number;
  /**
   * Trusted query-layer restriction used by a surface-bound QueryModel. These
   * ids are never accepted from an HTTP query. An empty list means no entity
   * is visible; omission is the internal/unbound behavior.
   */
  readonly authorized_entity_ids?: readonly Entity['id'][];
  /** Current facts whose evidence passed the same surface rights evaluation. */
  readonly authorized_fact_ids?: readonly string[];
}

export interface SearchHit {
  readonly entity: Entity;
  readonly match_kind: SearchMatchKind;
  /** Ordering score. Exact hits get 1; ranked hits get their text rank. */
  readonly score: number;
  /** The purely textual rank, kept so exact-first ordering is observable. */
  readonly text_rank: number;
  readonly exact: boolean;
  /** Which alias/slug/name matched, for "why did I get this result". */
  readonly matched_on: string | null;
  readonly explain: string;
}

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  /** True when a deterministic identifier match short-circuited ranking. */
  readonly exact_short_circuit: boolean;
  readonly exact_count: number;
  readonly facets: readonly FacetResult[];
  readonly strategy: {
    readonly exact_first: true;
    readonly full_text: boolean;
    readonly trigram: boolean;
    readonly vector: false;
  };
}

const DEFAULT_STATUSES: readonly EntityStatus[] = ['ACTIVE'];
const EXACT_TIERS: Record<number, SearchMatchKind> = {
  1: 'EXACT_IDENTIFIER',
  2: 'EXACT_SLUG',
  3: 'EXACT_NAME',
};
const FUZZY_KINDS: Record<number, SearchMatchKind> = {
  1: 'FULL_TEXT',
  2: 'TRIGRAM',
  3: 'SUBSTRING',
  4: 'FIELD_VALUE',
};

/** `id, slug, ...` → `e.id, e.slug, ...` for joined selects. */
const qualifiedEntityColumns = (alias: string): string =>
  ENTITY_COLUMNS.split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(', ');

const clampInt = (value: number | undefined, fallback: number, max: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.trunc(value), max));
};

/** Entity-level predicates shared by the exact and ranked passes. */
function entityScope(
  query: SearchQuery,
  registry: FieldMetadataRegistry,
  params: Params,
  alias = 'e',
): string {
  if (query.authorized_entity_ids !== undefined && query.authorized_entity_ids.length === 0) {
    return 'FALSE';
  }
  const statuses = query.statuses ?? DEFAULT_STATUSES;
  const clauses = [`${alias}.vertical_id = ${params.add(query.vertical_id)}`];
  if (query.authorized_entity_ids !== undefined) {
    clauses.push(
      `${alias}.id IN (${params.addAll([...query.authorized_entity_ids]).join(', ')})`,
    );
  }
  if (statuses.length > 0) {
    clauses.push(`${alias}.status IN (${params.addAll([...statuses]).join(', ')})`);
  }
  if (query.entity_type !== undefined) {
    clauses.push(`${alias}.entity_type = ${params.add(query.entity_type)}`);
  }
  clauses.push(
    ...facetFilterPredicates(
      query.filters ?? [],
      registry,
      alias,
      params,
      query.authorized_fact_ids,
    ),
  );
  return clauses.join(' AND ');
}

/**
 * The short-circuit. Deterministic equality only — no ranking, no similarity,
 * no stemming. If this returns rows, they lead the result set.
 */
export async function lookupExactIdentifier(
  driver: SqlDriver,
  registry: FieldMetadataRegistry,
  query: SearchQuery,
): Promise<{ entity: Entity; kind: SearchMatchKind; matched_on: string }[]> {
  const raw = query.text?.trim() ?? '';
  if (raw === '') return [];
  const candidates = identifierCandidates(raw);
  if (candidates.length === 0) return [];

  const params = new Params();
  const aliasList = params.addAll(candidates).join(', ');
  const slugList = params.addAll(candidates).join(', ');
  const nameList = params.addAll(candidates.map((candidate) => candidate.toLowerCase())).join(', ');
  const scope = entityScope(query, registry, params);

  const rows = await driver.query(
    `SELECT ${qualifiedEntityColumns('e')}, m.tier AS tier, m.matched_on AS matched_on
       FROM (
         SELECT a.entity_id AS entity_id, 1 AS tier, a.alias_value AS matched_on
           FROM current_entity_aliases a
          WHERE (a.normalized_value IN (${aliasList}) OR a.alias_value IN (${aliasList}))
         UNION ALL
         SELECT es.id, 2, es.canonical_slug
           FROM entities es
          WHERE es.canonical_slug IN (${slugList})
         UNION ALL
         SELECT en.id, 3, en.canonical_name
           FROM entities en
          WHERE lower(en.canonical_name) IN (${nameList})
       ) m
       JOIN entities e ON e.id = m.entity_id
      WHERE ${scope}
      ORDER BY m.tier, e.canonical_name`,
    params.values,
  );

  const seen = new Set<string>();
  const hits: { entity: Entity; kind: SearchMatchKind; matched_on: string }[] = [];
  for (const row of rows) {
    const entity = mapEntity(row);
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);
    hits.push({
      entity,
      kind: EXACT_TIERS[Number(row['tier'])] ?? 'EXACT_IDENTIFIER',
      matched_on: String(row['matched_on']),
    });
  }
  return hits;
}

/** The ranked pass: full-text over names and aliases, then fuzzy, then boosted fields. */
function buildMatchesCte(
  query: SearchQuery,
  registry: FieldMetadataRegistry,
  params: Params,
  trigram: boolean,
): string {
  const text = query.text?.trim() ?? '';
  const arms: string[] = [];

  const tsq = () => `plainto_tsquery('simple', ${params.add(text)})`;
  arms.push(
    `SELECT e.id AS entity_id,
            ts_rank(to_tsvector('simple', e.canonical_name), ${tsq()}) AS score,
            1 AS kind_rank
       FROM entities e
      WHERE to_tsvector('simple', e.canonical_name) @@ ${tsq()}`,
  );
  arms.push(
    `SELECT a.entity_id,
            ts_rank(to_tsvector('simple', a.alias_value), ${tsq()}) * 0.9,
            1
       FROM current_entity_aliases a
      WHERE to_tsvector('simple', a.alias_value) @@ ${tsq()}`,
  );

  if (trigram) {
    const threshold = String(query.fuzzy_threshold ?? 0.2);
    arms.push(
      `SELECT e.id, similarity(e.canonical_name, ${params.add(text)}) * 0.8, 2
         FROM entities e
        WHERE similarity(e.canonical_name, ${params.add(text)}) >= ${params.add(threshold)}::real`,
    );
    arms.push(
      `SELECT a.entity_id, similarity(a.alias_value, ${params.add(text)}) * 0.7, 2
         FROM current_entity_aliases a
        WHERE similarity(a.alias_value, ${params.add(text)}) >= ${params.add(threshold)}::real`,
    );
  } else {
    // Portable fallback when pg_trgm is not installed. Coarser, but it keeps
    // the same shape: fuzzy candidates rank below full-text and far below exact.
    const like = params.add(likePattern(text));
    arms.push(
      `SELECT e.id, 0.05, 3 FROM entities e
        WHERE lower(e.canonical_name) LIKE ${like} OR e.canonical_slug LIKE ${like}`,
    );
    arms.push(
      `SELECT a.entity_id, 0.04, 3 FROM current_entity_aliases a
        WHERE lower(a.alias_value) LIKE ${like}`,
    );
  }

  // Doc 04 "search_boost": a field's declared weight is what makes its values
  // searchable, not a hard-coded list of interesting columns.
  for (const field of registry.boosted()) {
    const authorizedFacts = query.authorized_fact_ids;
    if (authorizedFacts !== undefined && authorizedFacts.length === 0) continue;
    const accessPredicate =
      authorizedFacts === undefined
        ? ''
        : ` AND f.id IN (${params.addAll([...authorizedFacts]).join(', ')})`;
    arms.push(
      `SELECT f.entity_id, ${params.add(String(field.search_boost * 0.6))}::real, 4
         FROM facts f
        WHERE f.property = ${params.add(field.field)}
          AND ${CURRENT_FACT('f')}
          ${accessPredicate}
          AND lower(${VALUE_TEXT('f')}) LIKE ${params.add(likePattern(text))}`,
    );
  }

  return arms.join('\n UNION ALL\n');
}

/**
 * Faceted search over canonical entities.
 *
 * Ordering: every exact hit, in identifier → slug → name order, then ranked
 * hits by score. Exactness is not a bonus applied to a score; it is a separate
 * tier evaluated first.
 */
export async function searchEntities(
  driver: SqlDriver,
  registry: FieldMetadataRegistry,
  query: SearchQuery,
): Promise<SearchResult> {
  const limit = clampInt(query.limit, 20, 200) || 20;
  const offset = clampInt(query.offset, 0, 10_000);
  const text = query.text?.trim() ?? '';
  const trigram = text === '' ? false : await supportsTrigram(driver);

  const exact = await lookupExactIdentifier(driver, registry, query);
  const exactIds = new Set(exact.map((hit) => hit.entity.id));

  let ranked: { entity: Entity; score: number; kind: SearchMatchKind }[] = [];
  let rankedTotal = 0;

  if (text === '') {
    // Filter-only browse. Still goes through the same scope predicates, so the
    // filters behave identically with and without a text query.
    const params = new Params();
    const scope = entityScope(query, registry, params);
    const rows = await driver.query(
      `SELECT ${ENTITY_COLUMNS} FROM entities e WHERE ${scope}
        ORDER BY e.canonical_name LIMIT ${limit + offset}`,
      params.values,
    );
    ranked = rows.map((row) => ({ entity: mapEntity(row), score: 0, kind: 'FILTER_ONLY' as const }));
    const countParams = new Params();
    const countScope = entityScope(query, registry, countParams);
    const countRows = await driver.query(
      `SELECT count(*)::text AS total FROM entities e WHERE ${countScope}`,
      countParams.values,
    );
    rankedTotal = Number(countRows[0]?.['total'] ?? 0);
  } else {
    const params = new Params();
    const cte = buildMatchesCte(query, registry, params, trigram);
    const scope = entityScope(query, registry, params);
    const columns = qualifiedEntityColumns('e');

    // DISTINCT ON keeps the *best-scoring* arm per entity, so the reported
    // match kind is the one that actually produced the score rather than
    // whichever arm happened to sort first.
    const rows = await driver.query(
      `WITH matches AS (${cte}),
            best AS (
              SELECT DISTINCT ON (entity_id) entity_id, score, kind_rank
                FROM matches
               ORDER BY entity_id, score DESC, kind_rank
            )
       SELECT ${columns}, b.score AS score, b.kind_rank AS kind_rank
         FROM best b
         JOIN entities e ON e.id = b.entity_id
        WHERE ${scope}
        ORDER BY b.score DESC, e.canonical_name
        LIMIT ${limit + offset + exact.length}`,
      params.values,
    );
    ranked = rows.map((row) => ({
      entity: mapEntity(row),
      score: Number(row['score'] ?? 0),
      kind: FUZZY_KINDS[Number(row['kind_rank'])] ?? 'FULL_TEXT',
    }));

    const countParams = new Params();
    const countCte = buildMatchesCte(query, registry, countParams, trigram);
    const countScope = entityScope(query, registry, countParams);
    // Exclude entities already counted in the exact tier, so `total` is the
    // size of the union of the two tiers rather than their sum.
    const excludeExact =
      exact.length === 0
        ? ''
        : ` AND e.id NOT IN (${countParams.addAll(exact.map((hit) => hit.entity.id)).join(', ')})`;
    const countRows = await driver.query(
      `WITH matches AS (${countCte})
       SELECT count(DISTINCT m.entity_id)::text AS total
         FROM matches m JOIN entities e ON e.id = m.entity_id
        WHERE ${countScope}${excludeExact}`,
      countParams.values,
    );
    rankedTotal = Number(countRows[0]?.['total'] ?? 0);
  }

  const rankedByEntity = new Map(ranked.map((hit) => [hit.entity.id, hit] as const));

  // Rule 7, made structural: the exact tier is concatenated ahead of the ranked
  // tier before any score is compared.
  const hits: SearchHit[] = [
    ...exact.map((hit) => ({
      entity: hit.entity,
      match_kind: hit.kind,
      score: 1,
      text_rank: rankedByEntity.get(hit.entity.id)?.score ?? 0,
      exact: true,
      matched_on: hit.matched_on,
      explain:
        `Exact ${hit.kind === 'EXACT_IDENTIFIER' ? 'identifier' : hit.kind === 'EXACT_SLUG' ? 'slug' : 'name'} ` +
        `match on "${hit.matched_on}". Exact identifiers always rank above text similarity (AGENTS.md rule 7).`,
    })),
    ...ranked
      .filter((hit) => !exactIds.has(hit.entity.id))
      .map((hit) => ({
        entity: hit.entity,
        match_kind: hit.kind,
        score: hit.score,
        text_rank: hit.score,
        exact: false,
        matched_on: null,
        explain:
          hit.kind === 'FILTER_ONLY'
            ? 'Matched the active filters; no text query was supplied.'
            : `Ranked ${hit.kind.toLowerCase().replace('_', ' ')} match, score ${hit.score.toFixed(4)}.`,
      })),
  ];

  const page = hits.slice(offset, offset + limit);

  const facets =
    query.include_facets === true
      ? await computeFacets(driver, registry, {
          vertical_id: query.vertical_id,
          ...(query.entity_type === undefined ? {} : { entity_type: query.entity_type }),
          ...(query.authorized_entity_ids === undefined
            ? {}
            : { entity_ids: query.authorized_entity_ids }),
          ...(query.authorized_fact_ids === undefined
            ? {}
            : { authorized_fact_ids: query.authorized_fact_ids }),
        })
      : [];

  return {
    hits: page,
    // `rankedTotal` already excludes the exact hits (see the count query), so
    // the two tiers add without double-counting an entity that matched both.
    total: rankedTotal + exact.length,
    limit,
    offset,
    exact_short_circuit: exact.length > 0,
    exact_count: exact.length,
    facets,
    strategy: { exact_first: true, full_text: text !== '', trigram, vector: false },
  };
}
