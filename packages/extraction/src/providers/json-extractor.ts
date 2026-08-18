import type { ExtractorVersion } from '@data-foundry/canonical-schema';
import { jsonPointerLocator, joinJsonPointer, resolveJsonPointer } from '../locator.js';
import {
  applyRecordKeyPolicy,
  buildRecord,
  finishField,
  type FieldOutcome,
  type LocatedValue,
} from '../record-builder.js';
import type { ExtractionSchema, FieldRule } from '../schema.js';
import {
  ExtractionError,
  artifactText,
  type ExtractedRecord,
  type ExtractionArtifact,
  type ExtractionProvider,
} from '../types.js';

/**
 * JSON / API-feed extractor.
 *
 * Every value is addressed by an RFC 6901 JSON pointer that is absolute within
 * the artifact, so `/data/models/3/specs/seer2` is enough for the provenance
 * layer to re-read the exact value out of the stored bytes later.
 */
export class JsonExtractor implements ExtractionProvider {
  readonly name = 'json-extractor';
  readonly format = 'json' as const;
  readonly version: ExtractorVersion;

  constructor(version: ExtractorVersion = 'json-extractor@1.0.0') {
    this.version = version;
  }

  supports(schema: ExtractionSchema): boolean {
    return schema.format === 'json';
  }

  extract(artifact: ExtractionArtifact, schema: ExtractionSchema): Promise<ExtractedRecord[]> {
    if (!this.supports(schema)) {
      throw new ExtractionError(`JsonExtractor cannot handle format ${schema.format}`, {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
      });
    }

    let document: unknown;
    try {
      document = JSON.parse(artifactText(artifact));
    } catch (error) {
      throw new ExtractionError('artifact body is not valid JSON', {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
        cause: error,
      });
    }

    const scopes = resolveRecordScopes(document, schema);
    const records = scopes.map((scope, ordinal) =>
      buildRecord({
        schema,
        artifact: artifact.artifact,
        ordinal,
        record_locator: jsonPointerLocator(scope.pointer),
        outcomes: schema.fields.map((rule) => readField(scope, rule)),
      }),
    );
    return Promise.resolve(applyRecordKeyPolicy(schema, records));
  }
}

export const createJsonExtractor = (version?: ExtractorVersion): ExtractionProvider =>
  version === undefined ? new JsonExtractor() : new JsonExtractor(version);

interface JsonScope {
  readonly node: unknown;
  readonly pointer: string;
}

function resolveRecordScopes(document: unknown, schema: ExtractionSchema): JsonScope[] {
  const selector = schema.record;
  if (selector.kind === 'whole_document') {
    return [{ node: document, pointer: '' }];
  }
  if (selector.kind !== 'json_pointer') {
    throw new ExtractionError(
      `JsonExtractor cannot handle record selector ${selector.kind}`,
      { schemaId: schema.schema_id },
    );
  }
  const resolved = resolveJsonPointer(document, selector.pointer);
  if (!resolved.found) return [];
  if (Array.isArray(resolved.value)) {
    return resolved.value.map((node, index) => ({
      node,
      pointer: joinJsonPointer(selector.pointer, index),
    }));
  }
  return [{ node: resolved.value, pointer: selector.pointer }];
}

interface PointerMatch {
  readonly pointer: string;
  readonly value: unknown;
}

/** Walks a segment path, expanding `*` into every index/key at that level. */
function walkJsonPath(scope: JsonScope, path: readonly string[]): PointerMatch[] {
  let frontier: PointerMatch[] = [{ pointer: scope.pointer, value: scope.node }];
  for (const segment of path) {
    const next: PointerMatch[] = [];
    for (const current of frontier) {
      if (segment === '*') {
        if (Array.isArray(current.value)) {
          current.value.forEach((item, index) => {
            next.push({ pointer: joinJsonPointer(current.pointer, index), value: item });
          });
        } else if (current.value !== null && typeof current.value === 'object') {
          for (const [key, item] of Object.entries(current.value as Record<string, unknown>)) {
            next.push({ pointer: joinJsonPointer(current.pointer, key), value: item });
          }
        }
        continue;
      }
      if (Array.isArray(current.value)) {
        const index = Number(segment);
        if (Number.isInteger(index) && index >= 0 && index < current.value.length) {
          next.push({ pointer: joinJsonPointer(current.pointer, index), value: current.value[index] });
        }
        continue;
      }
      if (
        current.value !== null &&
        typeof current.value === 'object' &&
        segment in (current.value as object)
      ) {
        next.push({
          pointer: joinJsonPointer(current.pointer, segment),
          value: (current.value as Record<string, unknown>)[segment],
        });
      }
    }
    frontier = next;
  }
  return frontier;
}

/** JSON is typed; the source-native record is not. Scalars stringify, containers serialise. */
const stringifyJsonValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

function readField(scope: JsonScope, rule: FieldRule): FieldOutcome {
  const selector = rule.locate;
  let matches: PointerMatch[];

  if (selector.kind === 'json_pointer') {
    const absolute = joinJsonPointer(
      scope.pointer,
      ...(selector.pointer === '' ? [] : selector.pointer.slice(1).split('/')),
    );
    const resolved = resolveJsonPointer(scope.node, selector.pointer);
    matches = resolved.found ? [{ pointer: absolute, value: resolved.value }] : [];
  } else if (selector.kind === 'json_path') {
    matches = walkJsonPath(scope, selector.path);
  } else {
    return {
      field: rule.field,
      raw: null,
      locator: jsonPointerLocator(scope.pointer),
      match_count: 0,
      failure: {
        code: 'FIELD_PARSE_FAILURE',
        message: `JsonExtractor cannot handle field selector ${selector.kind}`,
      },
    };
  }

  const located: LocatedValue[] = [];
  for (const match of matches) {
    const raw = stringifyJsonValue(match.value);
    if (raw === null) continue;
    located.push({ value: raw, locator: jsonPointerLocator(match.pointer) });
  }

  return finishField(rule, located, jsonPointerLocator(scope.pointer));
}
