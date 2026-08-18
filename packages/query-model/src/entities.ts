/**
 * Entity lookups, redirect-aware.
 *
 * A merge must not break a URL or an API id (doc 04 `entity_redirects`). Every
 * entity read here follows the active redirect chain, so a consumer that saved
 * an id or a slug before a merge still lands on the surviving entity — and is
 * told that it was redirected, so the web layer can answer 301 instead of
 * silently serving different content at the old address.
 */
import type {
  AliasMatch,
  CanonicalStore,
  RedirectResolution,
} from '@data-foundry/canonical-store';
import type {
  Entity,
  EntityId,
  EntityRedirect,
  Identifier,
  Slug,
  VerticalId,
} from '@data-foundry/canonical-schema';
import { identifierCandidates } from './sql.js';

export interface RedirectTrace {
  readonly from_entity_id: EntityId | null;
  readonly from_slug: Slug | null;
  readonly hops: readonly EntityRedirect[];
  readonly reason: EntityRedirect['reason'] | null;
}

export interface EntityView {
  readonly entity: Entity;
  /** Non-null when the requested id/slug is no longer the canonical one. */
  readonly redirected_from: RedirectTrace | null;
}

const trace = (
  resolution: RedirectResolution,
  fromEntityId: EntityId | null,
  fromSlug: Slug | null,
): RedirectTrace | null => {
  if (resolution.hops.length === 0) return null;
  const last = resolution.hops[resolution.hops.length - 1];
  return {
    from_entity_id: fromEntityId,
    from_slug: fromSlug,
    hops: resolution.hops,
    reason: last?.reason ?? null,
  };
};

/** Fetch by id, following any active redirect (e.g. after a merge). */
export async function getEntityById(
  store: CanonicalStore,
  id: EntityId,
): Promise<EntityView | null> {
  const resolution = await store.resolveRedirect(id);
  const entity = await store.getEntityById(resolution.entity_id);
  if (entity === null) return null;
  return { entity, redirected_from: trace(resolution, id, null) };
}

/**
 * Fetch by canonical slug, honouring `entity_redirects` in both directions:
 * the slug may still exist on a merged entity, or it may only exist as a
 * retired `from_slug`.
 */
export async function getEntityBySlug(
  store: CanonicalStore,
  verticalId: VerticalId,
  entityType: Identifier,
  slug: Slug,
): Promise<EntityView | null> {
  const direct = await store.getEntityBySlug(verticalId, entityType, slug);
  if (direct !== null) {
    const resolution = await store.resolveRedirect(direct.id);
    if (!resolution.redirected) return { entity: direct, redirected_from: null };
    const target = await store.getEntityById(resolution.entity_id);
    if (target === null) return { entity: direct, redirected_from: null };
    return { entity: target, redirected_from: trace(resolution, direct.id, slug) };
  }

  // The slug itself was retired by a merge/split/rename.
  const redirect = await store.findRedirectBySlug(verticalId, slug);
  if (redirect === null) return null;
  const resolution = await store.resolveRedirect(redirect.from_entity_id);
  const target = await store.getEntityById(resolution.entity_id);
  if (target === null) return null;
  return { entity: target, redirected_from: trace(resolution, redirect.from_entity_id, slug) };
}

export interface IdentifierLookup {
  readonly vertical_id: VerticalId;
  readonly value: string;
  readonly alias_type?: Identifier;
  readonly entity_type?: Identifier;
}

/**
 * Deterministic identifier lookup — the fast path that AGENTS.md rule 7 says
 * must never be replaced by similarity. Redirects are followed so a part number
 * recorded against a since-merged entity still resolves.
 */
export async function lookupByIdentifier(
  store: CanonicalStore,
  lookup: IdentifierLookup,
): Promise<{ matches: readonly AliasMatch[]; entities: readonly EntityView[] }> {
  const raw = lookup.value.trim();
  if (raw === '') return { matches: [], entities: [] };

  // Rule 7: one definition of "exact" for the whole query layer. This used to
  // probe only {raw, lower, upper}, which never strips separators — so a
  // stored `24ACC636A003` was unreachable from `24acc6-36a003`, and this
  // function disagreed with `lookupExactIdentifier` about what "exact" means.
  const values = identifierCandidates(raw);
  const matches = await store.lookupByAlias({
    vertical_id: lookup.vertical_id,
    values,
    ...(lookup.alias_type === undefined ? {} : { alias_type: lookup.alias_type }),
    ...(lookup.entity_type === undefined ? {} : { entity_type: lookup.entity_type }),
  });

  const entities: EntityView[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const view = await getEntityById(store, match.entity.id);
    if (view === null || seen.has(view.entity.id)) continue;
    seen.add(view.entity.id);
    entities.push(view);
  }
  return { matches, entities };
}
