/**
 * Errors the canonical store raises at the write boundary.
 *
 * These are not generic database errors. Each one names an invariant from
 * AGENTS.md or doc 04 that the caller tried to violate, so a failed ingestion
 * run says *which rule* it broke rather than surfacing a constraint name.
 */

export class CanonicalStoreError extends Error {
  override readonly name: string = 'CanonicalStoreError';
}

/**
 * AGENTS.md rule 2 — "No published fact without evidence."
 *
 * Raised when a caller reaches the write path with an empty evidence set. The
 * public API is shaped so this should be a compile error first
 * (`readonly [T, ...T[]]`); this is the runtime backstop for JavaScript callers
 * and for evidence arrays built dynamically.
 */
export class MissingEvidenceError extends CanonicalStoreError {
  override readonly name = 'MissingEvidenceError';
  readonly subject: string;

  constructor(subject: string) {
    super(
      `Refusing to persist ${subject} with no evidence. ` +
        `AGENTS.md rule 2: no published fact without evidence. ` +
        `Attach at least one fact_evidence/relationship_evidence row in the same transaction.`,
    );
    this.subject = subject;
  }
}

/** A derived output was requested without one complete, stable input lineage. */
export class FactDependencyError extends CanonicalStoreError {
  override readonly name = 'FactDependencyError';
}

/** A referenced row does not exist (entity, artifact, source record, ...). */
export class NotFoundError extends CanonicalStoreError {
  override readonly name = 'NotFoundError';
  readonly table: string;
  readonly id: string;

  constructor(table: string, id: string) {
    super(`No row in ${table} with id ${id}`);
    this.table = table;
    this.id = id;
  }
}

/**
 * A write would have overwritten a recorded claim instead of superseding it.
 * The append-only fact model (ADR-0001) has no legitimate path that does this.
 */
export class DestructiveWriteError extends CanonicalStoreError {
  override readonly name = 'DestructiveWriteError';
}

/** The caller asked for something the underlying driver cannot do. */
export class DriverCapabilityError extends CanonicalStoreError {
  override readonly name = 'DriverCapabilityError';
}
