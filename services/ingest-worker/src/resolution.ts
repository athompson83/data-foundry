/**
 * Deterministic entity resolution (doc 06 step 1; Phase 1 of the roadmap).
 *
 * Phase 1 is **exact-identifier matching only**. There is no similarity score,
 * no fuzzy comparison and no probabilistic block scoring in this file, and
 * there must not be one until Phase 2 — AGENTS.md rule 7 is explicit that
 * deterministic matching is the first stop, not a fallback behind something
 * cleverer.
 *
 * What *is* here, because rule 3 requires it, is the audit trail. Every link
 * from a source record to a canonical entity writes a `resolution_candidates`
 * row carrying the identifiers it keyed on and a `resolution_judgments` row
 * recording the decision. Every pair that blocking proposes and the rules
 * reject writes a durable `NOT_MERGE` judgment, so the matcher is never allowed
 * to re-propose a pair it has already been told is wrong. Nothing merges
 * invisibly and nothing is deleted to undo a decision.
 */
import {
  compareCodeUnits,
  entityQualityScore,
  identityConfidence,
  type Entity,
  type EntityId,
  type Identifier,
  type IsoDateTime,
  type SourceId,
  type SourceRecordId,
  type VerticalId,
} from '@data-foundry/canonical-schema';
import { identifiersMatch } from '@data-foundry/normalization';
import { sha256Hex, stableStringify } from '@data-foundry/acquisition';
import type { CanonicalStore, SqlExecutor, SqlParam } from '@data-foundry/canonical-store';
import { primaryAliasType, resolvePublisher, type VerticalConfig } from './config.js';
import { AliasNormalizer, slugify } from './identifiers.js';

export interface AliasClaim {
  readonly aliasType: Identifier;
  /** The source's own spelling, preserved byte for byte. */
  readonly aliasValue: string;
  readonly normalizedValue: string;
  readonly strong: boolean;
}

export interface ResolveRecordInput {
  readonly entityType: Identifier;
  readonly aliases: readonly AliasClaim[];
  readonly manufacturer: Entity | null;
  readonly sourceId: SourceId;
  readonly sourceRecordId: SourceRecordId;
}

export interface ResolvedEntity {
  readonly entity: Entity;
  readonly created: boolean;
  readonly matchedOn: readonly string[];
}

export interface ResolverDeps {
  readonly store: CanonicalStore;
  readonly config: VerticalConfig;
  readonly verticalId: VerticalId;
  readonly now: IsoDateTime;
  /** Source key → authority rank, for choosing the display spelling. */
  readonly authorityBySourceId: ReadonlyMap<string, number>;
}

export class EntityResolver {
  readonly #deps: ResolverDeps;
  readonly #normalizer: AliasNormalizer;
  readonly diagnostics: string[] = [];

  constructor(deps: ResolverDeps) {
    this.#deps = deps;
    this.#normalizer = new AliasNormalizer(deps.config);
  }

  get normalizer(): AliasNormalizer {
    return this.#normalizer;
  }

  /**
   * Resolve a brand string to a manufacturer through the deterministic
   * publisher alias table. An unrecognised string is quarantined, never
   * auto-created: a catalogue that invents companies from unmatched brand text
   * grows phantom manufacturers that nothing can later merge away.
   */
  async resolveManufacturer(
    brand: string,
    sourceId: SourceId,
    executor?: SqlExecutor,
  ): Promise<Entity | null> {
    const publisher = resolvePublisher(this.#deps.config, brand);
    if (publisher === null) {
      this.diagnostics.push(
        `manufacturer "${brand}" matches no declared publisher alias; quarantined rather than created.`,
      );
      return null;
    }

    const slug = slugify(publisher.canonicalName);
    const entity = await this.#deps.store.upsertEntity(
      {
        vertical_id: this.#deps.verticalId,
        entity_type: 'manufacturer' as Identifier,
        canonical_name: publisher.canonicalName,
        canonical_slug: slug,
        status: 'ACTIVE',
        quality_score: entityQualityScore(0.5),
        first_seen_at: this.#deps.now,
        last_verified_at: this.#deps.now,
      },
      executor,
    );

    // The legal name is always asserted; the observed spelling is recorded as a
    // weak `name` alias only when it differs, so the alias index reflects what
    // sources actually wrote.
    await this.#writeAlias(
      entity.id,
      'legal_name',
      publisher.canonicalName,
      sourceId,
      0.99,
      undefined,
      executor,
    );
    if (brand.trim() !== publisher.canonicalName) {
      await this.#writeAlias(entity.id, 'name', brand.trim(), sourceId, 0.8, undefined, executor);
    }
    return entity;
  }

  /**
   * A manufacturer-scoped identifier encodes its manufacturer in its prefix
   * (`ACS-24ACC636A003`). When that prefix is itself a declared publisher
   * alias, it is recorded as a weak abbreviation — observed evidence for a
   * spelling the alias table already knows, never a new identity claim.
   */
  async recordScopedIdentifierPrefix(
    manufacturer: Entity,
    aliasType: string,
    aliasValue: string,
    sourceId: SourceId,
    executor?: SqlExecutor,
  ): Promise<void> {
    const declared = this.#deps.config.aliasTypes.find((alias) => alias.type === aliasType);
    if (declared?.scoped_to !== 'manufacturer') return;
    const prefix = aliasValue.split('-')[0];
    if (prefix === undefined || prefix === aliasValue) return;
    const publisher = resolvePublisher(this.#deps.config, prefix);
    if (publisher === null || slugify(publisher.canonicalName) !== manufacturer.canonical_slug) return;
    await this.#writeAlias(
      manufacturer.id,
      'abbreviation',
      prefix,
      sourceId,
      0.7,
      undefined,
      executor,
    );
  }

  /**
   * Link one source record to a canonical entity on exact identifier equality.
   *
   * Both halves of the deterministic claim are checked: the vertical-declared
   * normalized form must be equal, *and* `identifiersMatch()` from
   * `@data-foundry/normalization` must agree on the raw spellings. Recording
   * both in `explanation_features` is what makes the merge reviewable.
   */
  async resolveRecord(input: ResolveRecordInput, executor?: SqlExecutor): Promise<ResolvedEntity> {
    const strong = input.aliases.filter((alias) => alias.strong);
    const matches = new Map<EntityId, { entity: Entity; on: string[] }>();

    for (const alias of strong) {
      const found = await this.#deps.store.lookupByAlias(
        {
          vertical_id: this.#deps.verticalId,
          values: [alias.normalizedValue],
          alias_type: alias.aliasType,
          entity_type: input.entityType,
        },
        executor,
      );
      for (const match of found) {
        if (match.alias.normalized_value !== alias.normalizedValue) continue;
        const bucket = matches.get(match.entity.id) ?? { entity: match.entity, on: [] };
        bucket.on.push(
          `${alias.aliasType}=${alias.normalizedValue}` +
            (identifiersMatch(match.alias.alias_value, alias.aliasValue, { keep: 'alphanumeric', case: 'upper' })
              ? ''
              : ' (spelling differs)'),
        );
        matches.set(match.entity.id, bucket);
      }
    }

    // Two strong identifiers on one record pointing at different entities is a
    // real conflict, not something to average away. The record still joins an
    // entity so no data is lost while the queue is worked, but the attachment is
    // PROVISIONAL and every audit row below must say so.
    //
    // This used to write a NEEDS_REVIEW candidate here and then a MATCH
    // candidate for the SAME (source_record, entity) tuple a few statements
    // later — `#recordCandidate` found the first row and UPDATEd it in place,
    // so the review flag was erased by the very same resolution pass and the
    // surviving audit record claimed `deterministic: true`. There is now exactly
    // ONE candidate write for this record, and it carries the conflict.
    const conflictingEntityIds = matches.size > 1 ? [...matches.keys()].sort() : null;
    if (conflictingEntityIds !== null) {
      this.diagnostics.push(
        `source record ${input.sourceRecordId} matched ${matches.size} entities on strong identifiers; queued for review.`,
      );
    }

    // Which entity a conflicted record provisionally attaches to used to be
    // "smallest `entity.id`" — a random UUID, so a rebuild into a fresh
    // database attached the same record somewhere else (#8), and
    // `localeCompare` handed the comparison to the host's collator (#14).
    //
    // The rule is now age: the record joins the entity we have known longest.
    // That is the conservative choice while the conflict is queued — the older
    // canonical record is the one with public URLs, redirects and inbound
    // references already pointing at it, so a review that goes the other way
    // moves the least. `canonical_slug` settles any remaining tie and is a
    // total order in its own right: `entities_slug_key` is unique per
    // (vertical, entity_type), and every candidate here shares both.
    const existing = [...matches.values()].sort((left, right) => {
      const byFirstSeen =
        Date.parse(left.entity.first_seen_at) - Date.parse(right.entity.first_seen_at);
      if (byFirstSeen !== 0) return byFirstSeen;
      const byCreated = Date.parse(left.entity.created_at) - Date.parse(right.entity.created_at);
      if (byCreated !== 0) return byCreated;
      return compareCodeUnits(left.entity.canonical_slug, right.entity.canonical_slug);
    })[0];

    const display = preferredDisplay(input.aliases, this.#primaryAlias(input.entityType));
    let entity: Entity;
    let created = false;

    if (existing === undefined) {
      const slug = this.#buildSlug(input, display);
      entity = await this.#deps.store.upsertEntity(
        {
          vertical_id: this.#deps.verticalId,
          entity_type: input.entityType,
          canonical_name: this.#buildName(input, display),
          canonical_slug: slug,
          status: 'ACTIVE',
          // The quality worker owns this score (doc 04); ingestion sets a neutral
          // value rather than inventing one it has no signal for.
          quality_score: entityQualityScore(0.5),
          first_seen_at: this.#deps.now,
          last_verified_at: this.#deps.now,
        },
        executor,
      );
      created = entity.created_at === entity.updated_at;
    } else {
      // Freshness is updated on every run even when nothing changed — that is
      // the difference between "we have not checked" and "we checked and it is
      // unchanged".
      entity = await this.#deps.store.upsertEntity(
        {
          vertical_id: this.#deps.verticalId,
          entity_type: input.entityType,
          canonical_name: existing.entity.canonical_name,
          canonical_slug: existing.entity.canonical_slug,
          status: existing.entity.status,
          quality_score: existing.entity.quality_score,
          first_seen_at: existing.entity.first_seen_at,
          last_verified_at: this.#deps.now,
        },
        executor,
      );
    }

    for (const alias of input.aliases) {
      await this.#writeAlias(
        entity.id,
        alias.aliasType,
        alias.aliasValue,
        input.sourceId,
        alias.strong ? 0.99 : 0.6,
        alias.normalizedValue,
        executor,
      );
    }

    const finalName = await this.#preferredNameFromAliases(entity, input, executor);
    if (finalName !== null && finalName !== entity.canonical_name) {
      entity = await this.#deps.store.upsertEntity(
        {
          vertical_id: this.#deps.verticalId,
          entity_type: entity.entity_type,
          canonical_name: finalName,
          canonical_slug: entity.canonical_slug,
          status: entity.status,
          quality_score: entity.quality_score,
          first_seen_at: entity.first_seen_at,
          last_verified_at: this.#deps.now,
        },
        executor,
      );
    }

    // When the record conflicted, `existing.on` lists only the identifiers that
    // pointed at the WINNING entity — reporting just those is what made the old
    // audit row actively false, because the identifier that pointed elsewhere
    // was the whole reason for the conflict. Report every identifier involved.
    const matchedOn =
      conflictingEntityIds !== null
        ? [...new Set([...matches.values()].flatMap((bucket) => bucket.on))]
        : (existing?.on ?? strong.map((alias) => `${alias.aliasType}=${alias.normalizedValue}`));

    const candidateId = await this.#recordCandidate(
      {
        leftSourceRecordId: input.sourceRecordId,
        rightEntityId: entity.id,
        decision: conflictingEntityIds === null ? 'MATCH' : 'NEEDS_REVIEW',
        score: conflictingEntityIds === null ? 1 : 0.5,
        features:
          conflictingEntityIds === null
            ? {
                method: 'strong_identifier_exact_match',
                matched_on: matchedOn,
                deterministic: true,
                created_entity: existing === undefined,
              }
            : {
                method: 'strong_identifier_conflict',
                matched_on: matchedOn,
                // NOT a clean deterministic match: the identifiers disagree about
                // which entity this record belongs to.
                deterministic: false,
                created_entity: false,
                conflicting_entities: conflictingEntityIds,
                provisional_entity: entity.id,
                reason: 'strong identifiers on one record resolve to different entities',
              },
      },
      executor,
    );
    await this.#recordJudgment(
      {
        candidateId,
        verdict: 'MERGE',
        leftSourceRecordId: input.sourceRecordId,
        rightEntityId: entity.id,
        mergedInto: entity.id,
        // What this attachment rests on, and nothing about *this run*. The
        // identifiers come from the record itself rather than from `matchedOn`,
        // whose wording legitimately differs between the pass that creates an
        // entity and the pass that re-matches it — a difference in the trail's
        // narration, not in the claim being made.
        evidence: {
          method:
            conflictingEntityIds === null
              ? 'strong_identifier_exact_match'
              : 'strong_identifier_conflict',
          keyed_on: [
            ...new Set(strong.map((alias) => `${alias.aliasType}=${alias.normalizedValue}`)),
          ].sort(),
          conflicting_entities: conflictingEntityIds ?? [],
        },
        // A provisional attachment is still a merge that happened and must be
        // auditable and reversible (rule 3) — but it must not claim certainty.
        confidence: conflictingEntityIds === null ? 1 : 0.5,
        rationale:
          conflictingEntityIds !== null
            ? `PROVISIONAL: strong identifiers on this record resolve to ${conflictingEntityIds.length} ` +
              `entities (${conflictingEntityIds.join(', ')}) on ${matchedOn.join(', ')}. Attached to ` +
              `${entity.id} pending review; not a deterministic match.`
            : existing === undefined
              ? `New canonical entity created from ${matchedOn.join(', ') || 'no strong identifier'}.`
              : `Exact normalized identifier match on ${matchedOn.join(', ')}.`,
      },
      executor,
    );

    return { entity, created, matchedOn };
  }

  #primaryAlias(entityType: Identifier): string | null {
    return primaryAliasType(this.#deps.config, entityType);
  }

  /** `entities/<type>.yaml` `canonical_slug.pattern`, with its tokens resolved. */
  #buildSlug(input: ResolveRecordInput, display: AliasClaim | null): string {
    const definition = this.#deps.config.entities[input.entityType];
    const pattern = String(definition?.canonical_slug?.pattern ?? '{canonical_name}');
    const resolved = pattern.replace(/\{([a-z0-9_]+)\}/g, (_match, token: string) => {
      if (token === 'manufacturer_slug') return input.manufacturer?.canonical_slug ?? '';
      if (token === 'canonical_name') return this.#buildName(input, display);
      const alias = input.aliases.find((candidate) => candidate.aliasType === token);
      return alias?.normalizedValue ?? '';
    });
    return slugify(resolved);
  }

  /**
   * Display name.
   *
   * An entity scoped to a manufacturer reads as `<manufacturer> <identifier>`.
   * One named only by a coded reference reads as `<SCHEME> <value>`, where the
   * scheme is the leading segment of its alias type (`ahri_ref` → `AHRI`) —
   * a bare number is not a name a human can act on.
   */
  #buildName(input: ResolveRecordInput, display: AliasClaim | null): string {
    const value = display?.aliasValue ?? display?.normalizedValue ?? 'unknown';
    if (input.manufacturer !== null) {
      return `${input.manufacturer.canonical_name} ${value}`;
    }
    const primary = this.#primaryAlias(input.entityType);
    const scheme = primary === null ? null : (primary.split('_')[0] ?? '').toUpperCase();
    return scheme === null || scheme === '' ? value : `${scheme} ${value}`;
  }

  /** Rebuilds the display name from the stored spelling of the primary alias. */
  async #preferredNameFromAliases(
    entity: Entity,
    input: ResolveRecordInput,
    executor?: SqlExecutor,
  ): Promise<string | null> {
    const primary = this.#primaryAlias(entity.entity_type);
    if (primary === null) return null;
    const alias = (await this.#deps.store.listAliases(entity.id, executor)).find(
      (candidate) => candidate.alias_type === primary,
    );
    if (alias === undefined) return null;
    return this.#buildName(input, {
      aliasType: primary as Identifier,
      aliasValue: alias.alias_value,
      normalizedValue: alias.normalized_value,
      strong: true,
    });
  }

  /**
   * Write an alias, keeping the *best* display spelling.
   *
   * Four sources spelling one model number four ways collapse onto a single
   * alias row — that collapse is the point of the identifier layer. But the row
   * still carries one `alias_value`, and that value is what page titles, search
   * results and exports render, so it cannot be "whichever source was ingested
   * last". The preference is deterministic: a spelling that is already in
   * canonical form wins (`24ACC636A003` over `24ACC6 36A003`); failing that the
   * most authoritative source's spelling wins (`BTW-C2036`, which no source
   * writes collapsed); ties break by code unit.
   *
   * That last step used to be `localeCompare`, which decided the entity's
   * published name with the host's collator: `abc-9001` wins under `en_US` and
   * `ABC-9001` wins under `da_DK`, on plain ASCII (#14). The spelling a
   * customer sees is not allowed to depend on which machine ran the pipeline.
   */
  async #writeAlias(
    entityId: EntityId,
    aliasType: string,
    aliasValue: string,
    sourceId: SourceId,
    confidence: number,
    normalized?: string,
    executor?: SqlExecutor,
  ): Promise<void> {
    const normalizedValue = normalized ?? this.#normalizer.normalize(aliasType, aliasValue);
    if (normalizedValue === '') return;

    let display = aliasValue;
    let displaySource = sourceId;
    const rows = await (executor ?? this.#deps.store.driver).query(
      `SELECT alias_value, source_id FROM entity_aliases
        WHERE entity_id = $1 AND alias_type = $2 AND normalized_value = $3`,
      [entityId, aliasType, normalizedValue],
    );
    const existing = rows[0];
    if (existing !== undefined) {
      const stored = {
        value: String(existing['alias_value']),
        sourceId: existing['source_id'] === null ? null : (String(existing['source_id']) as SourceId),
      };
      const incoming = { value: aliasValue, sourceId };
      const winner = this.#preferDisplay(stored, incoming, normalizedValue);
      display = winner.value;
      displaySource = winner.sourceId ?? sourceId;
    }

    await this.#deps.store.addAlias(
      {
        entity_id: entityId,
        alias_type: aliasType as Identifier,
        alias_value: display,
        normalized_value: normalizedValue,
        source_id: displaySource,
        identity_confidence: identityConfidence(confidence),
        valid_from: this.#deps.now,
        valid_to: null,
      },
      executor,
    );
  }

  #preferDisplay<T extends { readonly value: string; readonly sourceId: SourceId | null }>(
    left: T,
    right: T,
    normalized: string,
  ): T {
    const score = (candidate: T): [number, number, string] => [
      candidate.value === normalized ? 1 : 0,
      candidate.sourceId === null ? 0 : (this.#deps.authorityBySourceId.get(candidate.sourceId) ?? 0),
      candidate.value,
    ];
    const [leftCanonical, leftAuthority, leftValue] = score(left);
    const [rightCanonical, rightAuthority, rightValue] = score(right);
    if (leftCanonical !== rightCanonical) return leftCanonical > rightCanonical ? left : right;
    if (leftAuthority !== rightAuthority) return leftAuthority > rightAuthority ? left : right;
    return compareCodeUnits(leftValue, rightValue) <= 0 ? left : right;
  }

  /* ---------------- resolution audit tables ---------------- */

  async #recordCandidate(
    input: {
      readonly leftSourceRecordId?: SourceRecordId;
      readonly leftEntityId?: EntityId;
      readonly rightEntityId: EntityId;
      readonly decision: 'PENDING' | 'MATCH' | 'NO_MATCH' | 'NEEDS_REVIEW';
      readonly score: number;
      readonly features: Record<string, unknown>;
    },
    executor?: SqlExecutor,
  ): Promise<string> {
    const driver = executor ?? this.#deps.store.driver;
    const left: SqlParam = input.leftEntityId ?? null;
    const leftRecord: SqlParam = input.leftSourceRecordId ?? null;

    const existing = await driver.query<{
      id: string;
      decision: string;
      explanation_features: unknown;
    }>(
      `SELECT id, decision, explanation_features FROM resolution_candidates
        WHERE vertical_id = $1
          AND left_entity_id IS NOT DISTINCT FROM $2
          AND left_source_record_id IS NOT DISTINCT FROM $3
          AND right_entity_id IS NOT DISTINCT FROM $4
          AND method = 'DETERMINISTIC'
        LIMIT 1`,
      [this.#deps.verticalId, left, leftRecord, input.rightEntityId],
    );
    const found = existing[0];
    if (found !== undefined) {
      // AGENTS.md rule 3: a queued human review may never be silently cleared by
      // an automated pass. Downgrading NEEDS_REVIEW to MATCH here is exactly how
      // a conflict used to disappear — the flag and the evidence for it were
      // overwritten by the same resolution run that raised them.
      //
      // A review flag can only be resolved by a human decision (which writes a
      // durable judgment), never by a re-run. Features are MERGED rather than
      // replaced so the conflict evidence survives whatever arrives later.
      const downgrade = found.decision === 'NEEDS_REVIEW' && input.decision !== 'NEEDS_REVIEW';
      if (downgrade) {
        const prior =
          found.explanation_features !== null && typeof found.explanation_features === 'object'
            ? (found.explanation_features as Record<string, unknown>)
            : {};
        await driver.query(
          `UPDATE resolution_candidates
              SET explanation_features = $2::jsonb, updated_at = now()
            WHERE id = $1`,
          [
            found.id,
            JSON.stringify({
              ...prior,
              superseded_attempt: { decision: input.decision, score: input.score, ...input.features },
              review_retained: 'an automated pass proposed a decision while review was pending',
            }),
          ],
        );
        this.diagnostics.push(
          `resolution candidate ${found.id} kept at NEEDS_REVIEW; an automated ${input.decision} was recorded but did not clear the review.`,
        );
        return found.id;
      }

      await driver.query(
        `UPDATE resolution_candidates
            SET decision = $2, score = $3, explanation_features = $4::jsonb, updated_at = now()
          WHERE id = $1`,
        [found.id, input.decision, input.score, JSON.stringify(input.features)],
      );
      return found.id;
    }

    const rows = await driver.query<{ id: string }>(
      `INSERT INTO resolution_candidates
         (vertical_id, left_entity_id, left_source_record_id, right_entity_id,
          right_source_record_id, method, score, explanation_features, decision)
       VALUES ($1, $2, $3, $4, NULL, 'DETERMINISTIC', $5, $6::jsonb, $7)
       RETURNING id`,
      [
        this.#deps.verticalId,
        left,
        leftRecord,
        input.rightEntityId,
        input.score,
        JSON.stringify(input.features),
        input.decision,
      ],
    );
    return String(rows[0]?.['id']);
  }

  /**
   * Append one resolution decision to the judgment trail (finding #2b).
   *
   * The trail used to be deduplicated on
   * `(vertical, left entity, left source record, right entity, verdict)`. That
   * tuple is the *pair*, not the *event*: a clean certain MERGE and a later
   * PROVISIONAL, conflicted MERGE about the same pair share it exactly, so the
   * second decision was dropped and the audit trail kept asserting the first
   * one long after it stopped being true.
   *
   * Event identity is therefore the pair plus two fingerprints — what the
   * decision rested on, and what was decided:
   *
   *   - identical to the current episode  → the same logical event, retried.
   *     Nothing is written, which is what keeps re-running a source idempotent.
   *   - anything else                     → a new episode. It is appended, the
   *     previous one stops being current (`active = FALSE`) but is never
   *     rewritten or deleted, and the new row names it in
   *     `supersedes_judgment_id`.
   *
   * `evidence` must carry only what the decision rested on. Per-run bookkeeping
   * (which run wrote it, whether the entity happened to be created on this
   * pass) would make every second run look like a new decision.
   */
  async #recordJudgment(
    input: {
      readonly candidateId: string | null;
      readonly verdict: 'MERGE' | 'NOT_MERGE' | 'SPLIT';
      readonly leftSourceRecordId?: SourceRecordId;
      readonly leftEntityId?: EntityId;
      readonly rightEntityId: EntityId;
      readonly mergedInto: EntityId | null;
      readonly confidence: number;
      readonly rationale: string;
      readonly evidence: Record<string, unknown>;
    },
    executor?: SqlExecutor,
  ): Promise<void> {
    const evidenceFingerprint = sha256Hex(stableStringify(input.evidence));
    const decisionFingerprint = sha256Hex(
      stableStringify({
        verdict: input.verdict,
        merged_into_entity_id: input.mergedInto ?? null,
        identity_confidence: input.confidence,
      }),
    );
    // Identity is the QUESTION this judgment answers, never the answer itself.
    //
    // A record asks "where do I belong?" — the entity is the answer, so keying
    // on it would open a second history every time a record moved, leaving the
    // old judgment active and the trail self-contradictory. Two entities ask
    // "are we the same?" — there both sides are the question. `verdict` is the
    // answer in both cases and belongs in neither key. These predicates match
    // the partial unique indexes in migration 0009 exactly; if they drift, the
    // database refuses the write rather than letting a stale judgment stand.
    const asksAboutRecord = input.leftSourceRecordId !== undefined && input.leftSourceRecordId !== null;
    const pair: SqlParam[] = asksAboutRecord
      ? [this.#deps.verticalId, input.leftSourceRecordId ?? null]
      : [this.#deps.verticalId, input.leftEntityId ?? null, input.rightEntityId];
    const PAIR_PREDICATE = asksAboutRecord
      ? `vertical_id = $1
          AND left_source_record_id IS NOT DISTINCT FROM $2`
      : `vertical_id = $1
          AND left_source_record_id IS NULL
          AND left_entity_id IS NOT DISTINCT FROM $2
          AND right_entity_id IS NOT DISTINCT FROM $3`;

    const writeJudgment = async (tx: SqlExecutor): Promise<void> => {
      const [current] = await tx.query<{
        id: string;
        episode_seq: number;
        evidence_fingerprint: string;
        decision_fingerprint: string;
      }>(
        `SELECT id::text AS id, episode_seq, evidence_fingerprint, decision_fingerprint
           FROM resolution_judgments
          WHERE ${PAIR_PREDICATE} AND active
          LIMIT 1`,
        pair,
      );

      if (
        current !== undefined &&
        current.evidence_fingerprint === evidenceFingerprint &&
        current.decision_fingerprint === decisionFingerprint
      ) {
        return;
      }

      // Numbered off the whole history, not off the current episode, so a
      // superseded number is never handed out twice.
      const [high] = await tx.query<{ max_seq: number }>(
        `SELECT COALESCE(MAX(episode_seq), 0)::int AS max_seq
           FROM resolution_judgments
          WHERE ${PAIR_PREDICATE}`,
        pair,
      );
      const episodeSeq = Number(high?.max_seq ?? 0) + 1;

      if (current !== undefined) {
        // The row keeps every byte of what was decided; only its currency
        // changes. `resolution_judgments_current_episode_key` makes this
        // mandatory rather than a convention a second writer could skip.
        await tx.query(`UPDATE resolution_judgments SET active = FALSE WHERE id = $1`, [
          current.id,
        ]);
        this.diagnostics.push(
          `resolution judgment ${current.id} superseded by a new episode: the evidence or the ` +
            `decision changed since it was recorded.`,
        );
      }

      await tx.query(
        `INSERT INTO resolution_judgments
           (vertical_id, candidate_id, verdict, left_entity_id, left_source_record_id,
            right_entity_id, right_source_record_id, merged_into_entity_id,
            decided_by_kind, decided_by_actor, decided_at, identity_confidence, rationale,
            active, evidence_fingerprint, decision_fingerprint, supersedes_judgment_id,
            episode_seq)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'RULE', $8, $9, $10, $11,
                 TRUE, $12, $13, $14, $15)`,
        [
          this.#deps.verticalId,
          input.candidateId,
          input.verdict,
          input.leftEntityId ?? null,
          input.leftSourceRecordId ?? null,
          input.rightEntityId,
          input.mergedInto,
          'ingest-worker/deterministic-identifier-resolver@1',
          this.#deps.now,
          input.confidence,
          input.rationale,
          evidenceFingerprint,
          decisionFingerprint,
          current?.id ?? null,
          episodeSeq,
        ],
      );
    };
    if (executor === undefined) {
      await this.#deps.store.driver.transaction(writeJudgment);
      return;
    }
    await writeJudgment(executor);
  }

  /**
   * The blocking pass (doc 06 step 4) and its negative judgments.
   *
   * Blocking exists to *generate candidates*, not to merge them. Phase 1 merges
   * nothing here: every pair blocking proposes is either rejected by a declared
   * rule — recorded as a durable `NOT_MERGE` so it is never re-proposed — or
   * left as `NEEDS_REVIEW` for a human. A pair that reaches this function has
   * already failed exact-identifier matching, and Phase 1 has nothing stronger
   * to offer it.
   */
  async runBlockingPass(): Promise<{ readonly proposed: number; readonly rejected: number }> {
    const resolution = this.#deps.config.entityResolution ?? {};
    const blockingKeys: string[] = (resolution.blocking_keys ?? []).map(String);
    const hardConflicts: string[] = (resolution.hard_conflict_properties ?? []).map(String);
    const neverMergeAcross: string[] = (resolution.never_merge_across ?? []).map(String);
    if (blockingKeys.length === 0) return { proposed: 0, rejected: 0 };

    const profiles = await this.#loadBlockingProfiles(hardConflicts);
    const blocks = new Map<string, EntityId[]>();
    for (const profile of profiles) {
      for (const key of blockingKeys) {
        const value = blockingValue(key, profile);
        if (value === null) continue;
        const bucket = blocks.get(`${key}=${value}`) ?? [];
        bucket.push(profile.id);
        blocks.set(`${key}=${value}`, bucket);
      }
    }

    const byId = new Map(profiles.map((profile) => [profile.id, profile] as const));
    const edges = await this.#loadPredicateEdges(neverMergeAcross);
    const seen = new Set<string>();
    let proposed = 0;
    let rejected = 0;

    // Pair direction is ordered by `canonical_slug`, not by entity id. A pair's
    // (left, right) direction is what a NOT_MERGE judgment records, and entity
    // ids are random UUIDs — so a rebuild from the same artifacts would flip
    // the direction of every negative judgment and the trail would not
    // reproduce (#8). The slug is unique per (vertical, entity_type) and every
    // entity here shares both, so it is a total order in its own right.
    const bySlug = (left: EntityId, right: EntityId): number =>
      compareCodeUnits(byId.get(left)?.slug ?? left, byId.get(right)?.slug ?? right);

    // Default sort would coerce each [key, EntityId[]] entry with String(),
    // making the sort key depend on member UUID order. Block order decides
    // which block owns a pair, and the block key is part of the fingerprint.
    for (const [blockKey, members] of [...blocks.entries()].sort(([left], [right]) =>
      compareCodeUnits(left, right),
    )) {
      const ordered = [...new Set(members)].sort(bySlug);
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const left = ordered[i] as EntityId;
          const right = ordered[j] as EntityId;
          const pairKey = `${left}|${right}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          proposed += 1;

          const leftProfile = byId.get(left);
          const rightProfile = byId.get(right);
          if (leftProfile === undefined || rightProfile === undefined) continue;

          const reasons = rejectionReasons({
            left: leftProfile,
            right: rightProfile,
            hardConflicts,
            edges,
          });

          const features: Record<string, unknown> = {
            blocking_key: blockKey,
            left: leftProfile.slug,
            right: rightProfile.slug,
            hard_conflicts: reasons,
          };

          if (reasons.length === 0) {
            // Nothing deterministic separates them and nothing deterministic
            // joins them either. Phase 1 stops here rather than guessing.
            await this.#recordCandidate({
              leftEntityId: left,
              rightEntityId: right,
              decision: 'NEEDS_REVIEW',
              score: Number(resolution.candidate_floor ?? 0.55),
              features,
            });
            continue;
          }

          rejected += 1;
          const candidateId = await this.#recordCandidate({
            leftEntityId: left,
            rightEntityId: right,
            decision: 'NO_MATCH',
            score: 0,
            features,
          });
          await this.#recordJudgment({
            candidateId,
            verdict: 'NOT_MERGE',
            leftEntityId: left,
            rightEntityId: right,
            mergedInto: null,
            confidence: 0.99,
            rationale: `Blocked by ${blockKey}; rejected because ${reasons.join('; ')}.`,
            // A pair rejected on a *different* conflict tomorrow is a different
            // decision, and must not be silently absorbed by today's.
            evidence: features,
          });
        }
      }
    }

    return { proposed, rejected };
  }

  async #loadBlockingProfiles(properties: readonly string[]): Promise<BlockingProfile[]> {
    const driver = this.#deps.store.driver;
    const rows = await driver.query(
      `SELECT e.id, e.canonical_slug, e.entity_type,
              (SELECT a.normalized_value FROM entity_aliases a
                WHERE a.entity_id = e.id AND a.alias_type = 'model_number'
                -- COLLATE "C": this LIMIT 1 picks the blocking key, which decides
                -- which pairs are ever compared and lands in the evidence
                -- fingerprint. A host collation must not choose it.
                ORDER BY a.normalized_value COLLATE "C" LIMIT 1) AS model_number,
              (SELECT m.canonical_slug FROM relationships r
                 JOIN entities m ON m.id = r.subject_entity_id
                WHERE r.object_entity_id = e.id AND r.predicate = 'manufactures'
                  AND r.valid_to IS NULL LIMIT 1) AS manufacturer_slug
         FROM entities e
        WHERE e.vertical_id = $1 AND e.entity_type = 'equipment_model' AND e.status = 'ACTIVE'
        ORDER BY e.id`,
      [this.#deps.verticalId],
    );

    const profiles: BlockingProfile[] = [];
    for (const row of rows) {
      const id = String(row['id']) as EntityId;
      const facts: Record<string, unknown> = {};
      for (const property of properties) {
        const selection = await this.#deps.store.selectFact(id, property as Identifier, {
          at: this.#deps.now,
        });
        if (selection.selected !== null) facts[property] = selection.selected.fact.normalized_value;
      }
      profiles.push({
        id,
        slug: String(row['canonical_slug']),
        modelNumber: row['model_number'] === null ? null : String(row['model_number']),
        manufacturerSlug: row['manufacturer_slug'] === null ? null : String(row['manufacturer_slug']),
        facts,
      });
    }
    return profiles;
  }

  /** Entity pairs joined by a predicate the vertical says identity never crosses. */
  async #loadPredicateEdges(predicates: readonly string[]): Promise<Set<string>> {
    const edges = new Set<string>();
    if (predicates.length === 0) return edges;
    const driver = this.#deps.store.driver;
    const rows = await driver.query(
      `SELECT subject_entity_id, object_entity_id, predicate FROM relationships
        WHERE vertical_id = $1 AND valid_to IS NULL AND status <> 'RETRACTED'`,
      [this.#deps.verticalId],
    );
    for (const row of rows) {
      if (!predicates.includes(String(row['predicate']))) continue;
      const a = String(row['subject_entity_id']);
      const b = String(row['object_entity_id']);
      edges.add([a, b].sort().join('|'));
    }
    return edges;
  }
}

interface BlockingProfile {
  readonly id: EntityId;
  readonly slug: string;
  readonly modelNumber: string | null;
  readonly manufacturerSlug: string | null;
  readonly facts: Readonly<Record<string, unknown>>;
}

function blockingValue(key: string, profile: BlockingProfile): string | null {
  if (key === 'normalized_manufacturer') return profile.manufacturerSlug;
  if (key === 'model_number_prefix_6') {
    return profile.modelNumber === null ? null : profile.modelNumber.slice(0, 6);
  }
  if (key === 'product_type_and_capacity_band') {
    const type = profile.facts['product_type'];
    const capacity = profile.facts['cooling_capacity_btu'];
    if (type === undefined || capacity === undefined) return null;
    return `${String(type)}:${String(capacity)}`;
  }
  return null;
}

function rejectionReasons(input: {
  readonly left: BlockingProfile;
  readonly right: BlockingProfile;
  readonly hardConflicts: readonly string[];
  readonly edges: ReadonlySet<string>;
}): string[] {
  const reasons: string[] = [];

  if (input.edges.has([input.left.id, input.right.id].sort().join('|'))) {
    reasons.push(
      'the pair is joined by a relationship this vertical declares identity never crosses ' +
        '(supersession is a replacement, not the same product)',
    );
  }
  if (
    input.left.manufacturerSlug !== null &&
    input.right.manufacturerSlug !== null &&
    input.left.manufacturerSlug !== input.right.manufacturerSlug
  ) {
    reasons.push(
      `different manufacturers (${input.left.manufacturerSlug} vs ${input.right.manufacturerSlug})`,
    );
  }
  for (const property of input.hardConflicts) {
    const a = input.left.facts[property];
    const b = input.right.facts[property];
    if (a === undefined || b === undefined) continue;
    if (a !== b) reasons.push(`hard conflict on ${property} (${String(a)} vs ${String(b)})`);
  }
  return reasons;
}

/** The identifier a display name is built from: the entity type's primary alias. */
function preferredDisplay(
  aliases: readonly AliasClaim[],
  primary: string | null,
): AliasClaim | null {
  if (primary !== null) {
    const match = aliases.find((alias) => alias.aliasType === primary);
    if (match !== undefined) return match;
  }
  return aliases.find((alias) => alias.strong) ?? aliases[0] ?? null;
}
