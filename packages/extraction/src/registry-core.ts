import { readdressRecords, unpackArchivedArtifact } from './archive.js';
import type { ExtractionSchema } from './schema.js';
import {
  ExtractionError,
  type ExtractedRecord,
  type ExtractionArtifact,
  type ExtractionProvider,
} from './types.js';

/**
 * Provider swapping is a first-class requirement (AGENTS.md rule 6, doc 02
 * "Provider abstraction"): a vertical selects an extractor by *format*, never by
 * naming a concrete class. Replacing `HtmlExtractor` with a Browser-Run-backed
 * one is a registry change, not a change to any vertical.
 */
export class ExtractionProviderRegistry {
  readonly #providers: ExtractionProvider[] = [];

  constructor(providers: readonly ExtractionProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: ExtractionProvider): this {
    this.#providers.push(provider);
    return this;
  }

  list(): readonly ExtractionProvider[] {
    return [...this.#providers];
  }

  /** Last registered provider that supports the schema wins, so callers can override defaults. */
  resolve(schema: ExtractionSchema): ExtractionProvider {
    for (let index = this.#providers.length - 1; index >= 0; index -= 1) {
      const provider = this.#providers[index];
      if (provider !== undefined && provider.supports(schema)) return provider;
    }
    throw new ExtractionError(`no extraction provider registered for format ${schema.format}`, {
      schemaId: schema.schema_id,
    });
  }

  /**
   * A schema that declares an `archive` is unpacked here, once, for every
   * provider: the provider parses the member, and its locators are re-addressed
   * to name that member inside the preserved archive artifact.
   */
  async extract(artifact: ExtractionArtifact, schema: ExtractionSchema): Promise<ExtractedRecord[]> {
    if (schema.archive === undefined) return this.resolve(schema).extract(artifact, schema);
    const unpacked = await unpackArchivedArtifact(artifact, schema);
    const records = await this.resolve(unpacked.schema).extract(unpacked.artifact, unpacked.schema);
    return readdressRecords(records, unpacked.member);
  }
}

