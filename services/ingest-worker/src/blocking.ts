/**
 * Declarative candidate-blocking vocabulary (doc 06 step 4).
 *
 * Blocking generates candidate pairs; it never merges (AGENTS.md rule 3). What
 * a vertical blocks on is configuration, not code (rule 4): each entry under
 * `entity_resolution.blocking_keys` in `vertical.yaml` names one key and says,
 * in the small closed vocabulary below, how its value is read from canonical
 * storage. A key the vocabulary cannot interpret is a validation error, never
 * a silent `null` — a vertical that believes it is blocking but is not would
 * propose no candidates and report nothing.
 *
 * Every kind reads an exact, already-normalized value (rule 7): there is no
 * similarity, tokenization or fuzzy banding here.
 *
 *   kind: alias            — the entity's lowest (code-unit order) current
 *                            normalized alias of `alias_type`, optionally cut
 *                            to its first `prefix_length` characters.
 *   kind: related_entity   — the canonical slug of the entity joined to this
 *                            one by `predicate`, where this entity plays `role`
 *                            (`subject` or `object`) in the relationship.
 *                            `reject_mismatch_as` optionally makes a pair whose
 *                            two related entities differ a hard rejection.
 *   kind: property_values  — the selected normalized values of `properties`,
 *                            joined with `:`; absent when any one is missing.
 *
 * Filesystem-free so the CI validator, the config loader and the resolver all
 * interpret the same declaration with the same code.
 */

export const BLOCKING_KEY_KINDS = ['alias', 'related_entity', 'property_values'] as const;
export type BlockingKeyKind = (typeof BLOCKING_KEY_KINDS)[number];

interface BlockingKeyBase {
  /** Block label; lands in candidate features and the evidence fingerprint. */
  readonly key: string;
  readonly entityType: string;
}

export interface AliasBlockingKey extends BlockingKeyBase {
  readonly kind: 'alias';
  readonly aliasType: string;
  readonly prefixLength: number | null;
}

export interface RelatedEntityBlockingKey extends BlockingKeyBase {
  readonly kind: 'related_entity';
  readonly predicate: string;
  readonly role: 'subject' | 'object';
  /** Plural noun for the rejection rationale, e.g. `manufacturers`. */
  readonly rejectMismatchAs: string | null;
}

export interface PropertyValuesBlockingKey extends BlockingKeyBase {
  readonly kind: 'property_values';
  readonly properties: readonly string[];
}

export type BlockingKey = AliasBlockingKey | RelatedEntityBlockingKey | PropertyValuesBlockingKey;

/** What the vertical declares elsewhere in `vertical.yaml`; keys may only reference these. */
export interface BlockingDeclarations {
  readonly entityTypes: readonly string[];
  readonly relationshipPredicates: readonly string[];
  readonly aliasTypes: readonly { readonly type: string; readonly applies_to: readonly string[] }[];
}

export interface ParsedBlockingKeys {
  readonly keys: readonly BlockingKey[];
  readonly errors: readonly string[];
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

const ALLOWED_FIELDS: Readonly<Record<BlockingKeyKind, readonly string[]>> = {
  alias: ['key', 'entity_type', 'kind', 'alias_type', 'prefix_length'],
  related_entity: ['key', 'entity_type', 'kind', 'predicate', 'role', 'reject_mismatch_as'],
  property_values: ['key', 'entity_type', 'kind', 'properties'],
};

/**
 * Parses `entity_resolution.blocking_keys`. Returns every problem found rather
 * than stopping at the first, so one validator run reports the whole list.
 */
export function parseBlockingKeys(raw: unknown, declared: BlockingDeclarations): ParsedBlockingKeys {
  const errors: string[] = [];
  const keys: BlockingKey[] = [];
  if (raw === undefined || raw === null) return { keys, errors };
  if (!Array.isArray(raw)) {
    return { keys, errors: ['entity_resolution.blocking_keys: must be a list'] };
  }

  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const at = `entity_resolution.blocking_keys[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(
        `${at}: undeclared blocking key ${JSON.stringify(entry)} — each key must be an object ` +
          `declaring key, entity_type and kind (one of ${BLOCKING_KEY_KINDS.join(', ')})`,
      );
      return;
    }
    const e = entry as Record<string, unknown>;
    const problems: string[] = [];

    const key = e['key'];
    if (typeof key !== 'string' || !IDENTIFIER.test(key)) {
      problems.push('key: must be a snake_case identifier');
    } else if (seen.has(key)) {
      problems.push(`key: duplicate blocking key "${key}"`);
    } else {
      seen.add(key);
    }

    const entityType = e['entity_type'];
    if (typeof entityType !== 'string' || !declared.entityTypes.includes(entityType)) {
      problems.push(`entity_type: ${JSON.stringify(entityType)} is not a declared entity type`);
    }

    const kind = e['kind'];
    if (typeof kind !== 'string' || !(BLOCKING_KEY_KINDS as readonly string[]).includes(kind)) {
      errors.push(
        ...problems.map((p) => `${at}.${p}`),
        `${at}.kind: ${JSON.stringify(kind)} is not a blocking key kind (one of ${BLOCKING_KEY_KINDS.join(', ')})`,
      );
      return;
    }
    const typedKind = kind as BlockingKeyKind;
    for (const field of Object.keys(e)) {
      if (!ALLOWED_FIELDS[typedKind].includes(field)) {
        problems.push(`${field}: not a field of kind ${typedKind}`);
      }
    }

    const base = { key: String(key), entityType: String(entityType) };
    let parsed: BlockingKey | null = null;
    if (typedKind === 'alias') {
      const aliasType = e['alias_type'];
      const alias = declared.aliasTypes.find((candidate) => candidate.type === aliasType);
      if (alias === undefined) {
        problems.push(`alias_type: ${JSON.stringify(aliasType)} is not a declared alias type`);
      } else if (typeof entityType === 'string' && !alias.applies_to.includes(entityType)) {
        problems.push(`alias_type: ${alias.type} does not apply to ${entityType}`);
      }
      const prefix = e['prefix_length'];
      if (prefix !== undefined && !(Number.isInteger(prefix) && (prefix as number) > 0)) {
        problems.push('prefix_length: must be a positive integer');
      }
      parsed = {
        ...base,
        kind: 'alias',
        aliasType: String(aliasType),
        prefixLength: prefix === undefined ? null : (prefix as number),
      };
    } else if (typedKind === 'related_entity') {
      const predicate = e['predicate'];
      if (typeof predicate !== 'string' || !declared.relationshipPredicates.includes(predicate)) {
        problems.push(`predicate: ${JSON.stringify(predicate)} is not a declared relationship predicate`);
      }
      const role = e['role'];
      if (role !== 'subject' && role !== 'object') {
        problems.push('role: must be subject or object');
      }
      const label = e['reject_mismatch_as'];
      if (label !== undefined && (typeof label !== 'string' || label.trim() === '')) {
        problems.push('reject_mismatch_as: must be a non-empty string');
      }
      parsed = {
        ...base,
        kind: 'related_entity',
        predicate: String(predicate),
        role: role === 'subject' ? 'subject' : 'object',
        rejectMismatchAs: label === undefined ? null : String(label),
      };
    } else {
      const properties = e['properties'];
      if (
        !Array.isArray(properties) ||
        properties.length === 0 ||
        !properties.every((p) => typeof p === 'string' && IDENTIFIER.test(p))
      ) {
        problems.push('properties: must be a non-empty list of property identifiers');
      }
      parsed = {
        ...base,
        kind: 'property_values',
        properties: Array.isArray(properties) ? properties.map(String) : [],
      };
    }

    if (problems.length > 0) {
      errors.push(...problems.map((p) => `${at}.${p}`));
      return;
    }
    keys.push(parsed);
  });

  return { keys, errors };
}

/** One entity as the blocking pass sees it. */
export interface BlockingProfile {
  readonly id: string;
  readonly slug: string;
  readonly entityType: string;
  /** Raw alias / related-entity value per key name, as read from storage. */
  readonly keyValues: ReadonlyMap<string, string | null>;
  readonly facts: Readonly<Record<string, unknown>>;
}

/** The block this profile falls into under `key`, or null when it has no value for it. */
export function blockingValue(key: BlockingKey, profile: BlockingProfile): string | null {
  if (key.entityType !== profile.entityType) return null;
  if (key.kind === 'alias') {
    const value = profile.keyValues.get(key.key) ?? null;
    if (value === null) return null;
    return key.prefixLength === null ? value : value.slice(0, key.prefixLength);
  }
  if (key.kind === 'related_entity') return profile.keyValues.get(key.key) ?? null;
  const parts: string[] = [];
  for (const property of key.properties) {
    const value = profile.facts[property];
    if (value === undefined) return null;
    parts.push(String(value));
  }
  return parts.join(':');
}
