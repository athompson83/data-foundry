import { ArtifactStoreError } from '../errors.js';
import type { ArtifactStore } from './artifact-store.js';
import {
  artifactContentPrefix,
  parseArtifactContentKey,
  parseArtifactRetrievalKey,
} from './keys.js';

/**
 * Finding the raw evidence nothing cites any more, and — only when explicitly
 * told to — removing it.
 *
 * Content addressing removes the *routine* source of orphans: a refresh that
 * re-fetches identical bytes now writes nothing. What it cannot remove is the
 * crash window. `runSource` stores the bytes and then writes the
 * `source_artifacts` row; a process that dies between the two, or a
 * transaction that rolls back, leaves an object no row will ever mention. That
 * is a slow leak with no upper bound, and nothing in the system could even
 * enumerate it before.
 *
 * The rules here are deliberately timid, because the failure mode is deleting
 * evidence a published fact depends on (AGENTS.md rule 10):
 *
 *   - **Nothing is deleted unless `apply` is set.** The default is a report.
 *   - **An empty reference set is refused outright.** "The database cites no
 *     artifacts" is far more likely to mean the caller failed to query than
 *     that every object is garbage, and acting on it would delete the archive.
 *   - **Recent objects are never touched.** An object written seconds ago is
 *     probably a run that is still going, not a leak. The grace period is a
 *     required argument, not a default someone can forget to think about.
 *   - **Retrieval records are never orphans.** They are self-describing
 *     history: a record naming content that was later found un-cited still says
 *     what we fetched and when, which is exactly the audit question they exist
 *     to answer.
 *   - **Anything unparseable is left alone and reported.** A key this module
 *     does not understand is not licence to delete it.
 */

export interface OrphanSweepInput {
  readonly store: ArtifactStore;
  readonly vertical: string;
  readonly source: string;
  /** Every `r2_uri` the canonical layer cites. Empty is refused, not obeyed. */
  readonly referencedUris: ReadonlySet<string>;
  /**
   * Objects younger than this are left alone: a run may still be between
   * storing bytes and committing its row.
   */
  readonly minimumAgeMs: number;
  /** The instant to measure age against. Injected so the sweep is testable. */
  readonly now: number;
  /** Age of a key, or null when the store cannot say. Unknown age is never swept. */
  readonly ageOf: (key: string) => Promise<number | null>;
  /** Without this, the sweep reports and deletes nothing. */
  readonly apply?: boolean | undefined;
}

export interface OrphanSweepReport {
  readonly scanned: number;
  /** Content objects no `source_artifacts` row points at, old enough to remove. */
  readonly orphaned: readonly string[];
  /** Orphans that were actually removed — empty unless `apply` was set. */
  readonly deleted: readonly string[];
  /** Orphaned but still inside the grace period, or of unknown age. */
  readonly skippedTooRecent: readonly string[];
  /** Keys under the prefix this module does not recognise. Never deleted. */
  readonly unrecognised: readonly string[];
}

export async function sweepOrphanedArtifacts(
  input: OrphanSweepInput,
): Promise<OrphanSweepReport> {
  if (input.referencedUris.size === 0) {
    throw new ArtifactStoreError(
      'Refusing to sweep with an empty reference set: an artifact store whose contents are ' +
        'cited by nothing is almost always a failed query, and sweeping on it would delete the ' +
        'archive (AGENTS.md rule 10).',
    );
  }
  if (!Number.isFinite(input.minimumAgeMs) || input.minimumAgeMs < 0) {
    throw new ArtifactStoreError(
      `Refusing to sweep with minimumAgeMs=${String(input.minimumAgeMs)}: a sweep with no grace ` +
        'period races every run that is between storing bytes and committing its row.',
    );
  }

  const prefix = artifactContentPrefix(input.vertical, input.source);
  const keys = await input.store.list(prefix);

  const orphaned: string[] = [];
  const deleted: string[] = [];
  const skippedTooRecent: string[] = [];
  const unrecognised: string[] = [];

  for (const key of keys) {
    if (parseArtifactRetrievalKey(key) !== null) continue;
    if (parseArtifactContentKey(key) === null) {
      unrecognised.push(key);
      continue;
    }
    if (input.referencedUris.has(input.store.uriFor(key))) continue;

    const age = await input.ageOf(key);
    if (age === null || age < input.minimumAgeMs) {
      skippedTooRecent.push(key);
      continue;
    }
    orphaned.push(key);
  }

  if (input.apply === true) {
    for (const key of orphaned) {
      await input.store.delete(key);
      deleted.push(key);
    }
  }

  return { scanned: keys.length, orphaned, deleted, skippedTooRecent, unrecognised };
}
