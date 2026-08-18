import type { Slug } from '@data-foundry/canonical-schema';
import { SourceRegistryEntrySchema, type SourceKey, type SourceRegistryEntry } from './entry.js';

/**
 * How the platform reads source declarations.
 *
 * Deliberately an interface, not a filesystem reader: Wave 1 loads YAML from
 * `verticals/<slug>/sources/`, the admin console will load from Postgres, and
 * tests load from memory. Nothing downstream should care which.
 */
export interface SourceRegistryLoader {
  /** Vertical slugs this registry can serve. */
  listVerticals(): Promise<readonly Slug[]>;
  /** Every declared source for a vertical, including inactive and RED ones. */
  listSources(verticalSlug: Slug): Promise<readonly SourceRegistryEntry[]>;
  /** A single source by its stable key, or `null` if undeclared. */
  getSource(verticalSlug: Slug, key: SourceKey): Promise<SourceRegistryEntry | null>;
}

export class SourceRegistryError extends Error {
  override readonly name = 'SourceRegistryError';
}

/**
 * In-memory loader. Used by tests and by CI's vertical-config validation, which
 * parses the YAML itself and then hands the parsed entries here.
 */
export class InMemorySourceRegistry implements SourceRegistryLoader {
  readonly #byVertical: Map<Slug, Map<SourceKey, SourceRegistryEntry>>;

  constructor(entries: readonly SourceRegistryEntry[]) {
    this.#byVertical = new Map();
    for (const raw of entries) {
      const entry = SourceRegistryEntrySchema.parse(raw);
      const bucket = this.#byVertical.get(entry.vertical_slug) ?? new Map();
      if (bucket.has(entry.key)) {
        throw new SourceRegistryError(
          `Duplicate source key "${entry.key}" in vertical "${entry.vertical_slug}"`,
        );
      }
      bucket.set(entry.key, entry);
      this.#byVertical.set(entry.vertical_slug, bucket);
    }
  }

  listVerticals(): Promise<readonly Slug[]> {
    return Promise.resolve([...this.#byVertical.keys()]);
  }

  listSources(verticalSlug: Slug): Promise<readonly SourceRegistryEntry[]> {
    const bucket = this.#byVertical.get(verticalSlug);
    return Promise.resolve(bucket === undefined ? [] : [...bucket.values()]);
  }

  getSource(verticalSlug: Slug, key: SourceKey): Promise<SourceRegistryEntry | null> {
    return Promise.resolve(this.#byVertical.get(verticalSlug)?.get(key) ?? null);
  }
}

/**
 * Parse-and-validate helper for registry files. Returns the typed entry or a
 * list of human-readable problems — CI prints these, so they have to name the
 * field.
 */
export type SourceEntryParseResult =
  | { readonly ok: true; readonly entry: SourceRegistryEntry }
  | { readonly ok: false; readonly errors: readonly string[] };

export function parseSourceRegistryEntry(input: unknown): SourceEntryParseResult {
  const parsed = SourceRegistryEntrySchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, entry: parsed.data };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
