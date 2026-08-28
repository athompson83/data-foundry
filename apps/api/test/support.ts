/**
 * API fixtures: the query layer's own PGlite harness with an app in front of it.
 *
 * Nothing here mocks `QueryModel`. The suite boots a real PGlite, applies the
 * real `db/migrations` with the real runner, and builds the same
 * `createQueryFixtures` the query-layer tests use. An API test that stubbed the
 * query layer would prove only that the stub agrees with the assertion —
 * whereas the properties worth testing here (rule 1 exclusion, redirect
 * following, exact-before-fuzzy ordering) are properties of the real thing.
 */
import {
  claim,
  createQueryFixtures,
  addSyntheticEntityEvidence,
  relate,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import type { Entity } from '../../../packages/canonical-schema/src/index.js';
import { createApiApp } from '../src/index.js';
import type { ApiFactSelectionPolicy, ApiRequestTelemetry } from '../src/config.js';
import type { ApiHandler, ApiRequest, ApiResponse } from '../src/http.js';

export { addSyntheticEntityEvidence, claim, createQueryFixtures, relate, ts };
export type { QueryFixtures };

/**
 * The property whose only claim comes from an UNREVIEWED source. Rule 1 says it
 * must never reach a published surface; the assertions name it by this constant
 * so a rename cannot quietly disable the check.
 */
export const RIGHTS_BLOCKED_PROPERTY = 'forum_rumor';
export const RIGHTS_BLOCKED_VALUE = 'sounds-like-40-decibels';

/** Extra properties so paging has something longer than one page to page. */
export const EXTRA_PROPERTIES = [
  'airflow_cfm',
  'compressor_stages',
  'eer2_rating',
  'hspf2_rating',
  'sound_level_db',
  'voltage',
  'warranty_years',
  'weight_lb',
] as const;

export interface ApiFixtures extends QueryFixtures {
  readonly app: ApiHandler;
  /** Errors the app funnelled to its operator channel, newest last. */
  readonly logged: { error: unknown; path: string }[];
}

export interface ApiFixtureOptions {
  readonly factSelection?: ApiFactSelectionPolicy;
  readonly trigram?: boolean;
}

export async function createApiFixtures(
  options: ApiFixtureOptions = {},
): Promise<ApiFixtures> {
  const base = await createQueryFixtures(
    options.trigram === undefined ? {} : { trigram: options.trigram },
  );
  await seedSyntheticSurfaceRights(base, ['API_FREE']);
  for (const entity of [base.equipment, base.heatPump, base.motor, base.rival]) {
    await addSyntheticEntityEvidence(base, entity);
  }

  // A claim nobody may publish: its only evidence comes from an UNREVIEWED
  // community source (AGENTS.md rule 1).
  await claim(base, 'blocked', {
    property: RIGHTS_BLOCKED_PROPERTY,
    value: RIGHTS_BLOCKED_VALUE,
    entity_id: base.equipment.id,
  });

  for (const [index, property] of EXTRA_PROPERTIES.entries()) {
    await claim(base, 'manufacturer', {
      property,
      value: index + 1,
      value_type: 'number',
      entity_id: base.equipment.id,
    });
  }

  await relate(base, base.equipment, 'has_part', base.motor);
  await relate(base, base.equipment, 'replaced_by', base.heatPump);

  const logged: { error: unknown; path: string }[] = [];
  const app = createApiApp({
    queryModel: base.qm,
    verticalId: base.vertical.id,
    ...(options.factSelection === undefined ? {} : { factSelection: options.factSelection }),
    onError: (error, context) => {
      logged.push({ error, path: context.path });
    },
  });

  return { ...base, app, logged };
}

/** Issue a request without a socket. */
export function call(
  app: ApiHandler,
  url: string,
  init: {
    readonly method?: string;
    readonly headers?: ApiRequest['headers'];
    readonly onRequest?: (info: ApiRequestTelemetry) => void;
  } = {},
): Promise<ApiResponse> {
  return app(
    {
      method: init.method ?? 'GET',
      url,
      ...(init.headers === undefined ? {} : { headers: init.headers }),
    },
    init.onRequest,
    { surface: 'API_FREE' },
  );
}

/** The error envelope, narrowed. Throws if the body is not one. */
export function errorOf(response: ApiResponse): {
  code: string;
  status: number;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
} {
  const body = response.body as { error?: Record<string, unknown> };
  if (body.error === undefined) {
    throw new Error(`expected an error envelope, got ${JSON.stringify(response.body)}`);
  }
  return body.error as ReturnType<typeof errorOf>;
}

export const dataOf = <T,>(response: ApiResponse): T => (response.body as { data: T }).data;

export const pageOf = (
  response: ApiResponse,
): { limit: number; offset: number; total: number; hasMore: boolean } =>
  (response.body as { page: { limit: number; offset: number; total: number; hasMore: boolean } }).page;

export const nameOf = (entity: Entity): string => entity.canonical_name;
