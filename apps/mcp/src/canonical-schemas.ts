/**
 * Tool argument constraints, derived from the generated canonical JSON Schema
 * exports rather than retyped here.
 *
 * `tooling/scripts/generate-json-schemas.ts` names its consumers explicitly:
 *
 * > "these JSON Schema files are a build output for consumers that cannot
 * >  import TypeScript — OpenAPI generation, MCP tool definitions, ..."
 *
 * This is that consumer. An MCP tool that says a property name is
 * `^[a-z][a-z0-9_]*$` because someone typed that regex into a tool definition
 * is a shape that drifts the moment `IdentifierSchema` changes; one that reads
 * the constraint out of `schemas/canonical/facts.schema.json` cannot, because
 * `pnpm schemas:check` fails CI when that export stops matching the Zod source
 * of truth.
 *
 * JSON is imported, not read from disk: the eventual deployment target is a
 * Cloudflare Worker (AGENTS.md), where a bundler inlines a static import and
 * `node:fs` does not exist at request time.
 */
import { z } from 'zod';
import entitiesSchema from '../../../schemas/canonical/entities.schema.json' with { type: 'json' };
import factsSchema from '../../../schemas/canonical/facts.schema.json' with { type: 'json' };

/** The subset of JSON Schema the generator emits for a scalar column. */
interface ScalarFieldSchema {
  readonly type?: string;
  readonly format?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly enum?: readonly string[];
}

interface ObjectSchema {
  readonly $id?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

/**
 * Fail loudly rather than silently falling back to an unconstrained string.
 * A tool schema that quietly stops enforcing a pattern is the defect this
 * module exists to prevent, so a missing field is a startup error.
 */
function field(document: ObjectSchema, name: string, object: string): ScalarFieldSchema {
  const found = document.properties?.[name];
  if (found === undefined || typeof found !== 'object' || found === null) {
    throw new Error(
      `schemas/canonical/${object}.schema.json has no property "${name}". The MCP tool ` +
        'definitions derive their argument constraints from it; regenerate with ' +
        '"pnpm schemas:generate" or update the field name here.',
    );
  }
  return found as ScalarFieldSchema;
}

/** Build a Zod string from a generated fragment, keeping every constraint. */
function stringFrom(fragment: ScalarFieldSchema, label: string): z.ZodString {
  let schema = z.string();
  if (fragment.minLength !== undefined) schema = schema.min(fragment.minLength);
  if (fragment.maxLength !== undefined) schema = schema.max(fragment.maxLength);
  if (fragment.pattern !== undefined) {
    schema = schema.regex(new RegExp(fragment.pattern), `must match the canonical ${label} format`);
  }
  return schema;
}

const ENTITIES = entitiesSchema as ObjectSchema;
const FACTS = factsSchema as ObjectSchema;

/** The exported JSON Schema documents these constraints came from. */
export const DERIVED_FROM: readonly string[] = [
  ENTITIES.$id ?? 'entities.schema.json',
  FACTS.$id ?? 'facts.schema.json',
];

/**
 * A canonical entity id. `format: uuid` plus the generated pattern — the
 * pattern is the load-bearing half, because `format` is annotation-only in
 * JSON Schema and a validator is free to ignore it.
 */
export const ENTITY_ID_FIELD = field(ENTITIES, 'id', 'entities');
export const EntityIdArg = stringFrom(ENTITY_ID_FIELD, 'entity id');

/** A vertical-defined identifier: entity type, fact property, predicate. */
export const IDENTIFIER_FIELD = field(FACTS, 'property', 'facts');
export const IdentifierArg = stringFrom(IDENTIFIER_FIELD, 'identifier');

/** A canonical URL slug. */
export const SLUG_FIELD = field(ENTITIES, 'canonical_slug', 'entities');
export const SlugArg = stringFrom(SLUG_FIELD, 'slug');

/** An ISO-8601 timestamp with offset, as every canonical timestamp is. */
export const TIMESTAMP_FIELD = field(FACTS, 'valid_from', 'facts');
export const TimestampArg = stringFrom(TIMESTAMP_FIELD, 'timestamp');

/**
 * The canonical name column bounds a free-text identifier argument: whatever a
 * caller read off a nameplate has to fit in the columns it will be matched
 * against.
 */
export const NAME_FIELD = field(ENTITIES, 'canonical_name', 'entities');
export const FreeTextIdentifierArg = z.string().min(1).max(NAME_FIELD.maxLength ?? 500);
