import type { Entity } from '@data-foundry/canonical-schema';
import type {
  SurfaceEntityListQuery,
  SurfaceQueryModel,
} from '@data-foundry/query-model';
import type { SitemapScanBudget } from './sitemap-capacity.js';

/** Matches the canonical query layer's bounded raw-entity read ceiling. */
export const SITEMAP_ENTITY_SCAN_PAGE_SIZE = 200;

export class SurfaceEntityScanProtocolError extends Error {
  constructor() {
    super('Sitemap keyset pagination returned a non-advancing cursor.');
    this.name = 'SurfaceEntityScanProtocolError';
  }
}

export interface SurfaceEntityPageScan {
  readonly vertical_id: SurfaceEntityListQuery['vertical_id'];
  readonly entity_type?: SurfaceEntityListQuery['entity_type'];
}

/**
 * Stream authorized entities one bounded raw page at a time. The continuation
 * is the last raw row inspected, so an all-denied page can still advance.
 */
export async function* scanSurfaceEntityPages(
  model: SurfaceQueryModel,
  query: SurfaceEntityPageScan,
  budget: SitemapScanBudget,
): AsyncGenerator<readonly Entity[]> {
  let afterId: Entity['id'] | undefined;

  for (;;) {
    budget.consume();
    const result = await model.listEntities({
      vertical_id: query.vertical_id,
      ...(query.entity_type === undefined ? {} : { entity_type: query.entity_type }),
      limit: SITEMAP_ENTITY_SCAN_PAGE_SIZE,
      ...(afterId === undefined ? {} : { after_id: afterId }),
    });
    yield result.entities;

    if (result.next_after_id === null) return;
    if (afterId !== undefined && result.next_after_id <= afterId) {
      throw new SurfaceEntityScanProtocolError();
    }
    afterId = result.next_after_id;
  }
}
