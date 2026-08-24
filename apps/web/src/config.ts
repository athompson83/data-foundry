import type { WebDeployment } from './composition.js';

export interface WebContext {
  readonly deployment: WebDeployment;
  /** Injectable so gate evaluation (staleness) is deterministic in tests. */
  readonly now: () => Date;
}

export function resolveContext(deployment: WebDeployment, now: () => Date = () => new Date()): WebContext {
  return { deployment, now };
}
