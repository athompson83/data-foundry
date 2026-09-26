import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface EdgeVerticalTemplate {
  /** The only `VERTICAL_SLUG` (and `/v1/<slug>` prefix) this Worker may serve. */
  readonly verticalSlug: string;
  /** The Worker `name` the tracked template and its ignored manifest must carry. */
  readonly workerName: string;
  /** Tracked template, for example `apps/edge/wrangler.vehicles.toml`. */
  readonly configPath: string;
  /** Ignored deployment manifest, for example `apps/edge/wrangler.vehicles.production.toml`. */
  readonly deploymentConfigPath: string;
}

function edgeVerticalTemplate(verticalSlug: string): EdgeVerticalTemplate {
  return {
    verticalSlug,
    workerName: `data-foundry-edge-${verticalSlug}`,
    configPath: join(REPO_ROOT, 'apps', 'edge', `wrangler.${verticalSlug}.toml`),
    deploymentConfigPath: join(REPO_ROOT, 'apps', 'edge', `wrangler.${verticalSlug}.production.toml`),
  };
}

/**
 * Additional per-vertical edge Workers (ADR-0011 isolation behind the ADR-0012
 * canonical `api.data.aroqon.com/v1/<slug>/*` contract). Each is the same
 * `apps/edge` code under its own Worker name, `VERTICAL_SLUG` and matching
 * `API_PATH_PREFIX`. The tracked template is always checked; its ignored
 * production manifest is optional, because an HVAC-only deployment remains a
 * complete and valid release shape. Onboarding another vertical's edge is one
 * entry here plus its template.
 *
 * This registry is dependency-free so operator tools such as
 * `credentials:provision` can share it without loading compiled runtimes.
 */
export const EDGE_VERTICAL_TEMPLATES: readonly EdgeVerticalTemplate[] = [
  edgeVerticalTemplate('vehicles'),
];
