import type { IsoDateTime } from '@data-foundry/canonical-schema';
import {
  materializeRequestDeployment,
  type RequestWebDeployment,
  type WebDeployment,
} from './composition.js';

export interface WebContext {
  readonly deployment: RequestWebDeployment;
  /** Frozen once so rights, quality, and freshness share one request instant. */
  readonly now: () => Date;
}

/** Freeze the clock and both distribution surfaces exactly once per request. */
export function resolveContext(
  deployment: WebDeployment,
  now: () => Date = () => new Date(),
): WebContext {
  const requestNow = now();
  const asOf = requestNow.toISOString() as IsoDateTime;
  return {
    deployment: materializeRequestDeployment(deployment, asOf),
    now: () => requestNow,
  };
}
