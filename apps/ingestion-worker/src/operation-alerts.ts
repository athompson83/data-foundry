import { OperationAlertStore, type OperationAlertClaim, type OperationAlertCode, type OperationAlertOutcome, type SqlDriver } from '@data-foundry/canonical-store';

/** Current Cloudflare Email Service structured send binding; no MIME dependency. */
export interface OperationEmailBinding {
  send(message: { readonly from: string; readonly to: string; readonly subject: string; readonly text: string }): Promise<{ readonly messageId: string }>;
}
export interface OperationAlertsEnv {
  readonly OPS_ALERTS_ENABLED?: string;
  readonly OPS_EMAIL?: OperationEmailBinding;
  readonly OPS_ALERT_FROM?: string;
  readonly OPS_ALERT_TO?: string;
}
export interface OperationAlertsConfig {
  readonly binding: OperationEmailBinding;
  readonly from: string;
  readonly to: string;
}
export interface OperationAlertSummary {
  readonly enabled: boolean;
  readonly transitions: number;
  readonly attempted: number;
  readonly accepted: number;
  readonly failed: number;
  readonly unknown: number;
}

function isSingleAddress(value: unknown): value is string {
  // Only a fixed plain mailbox is accepted: no display names, lists, whitespace,
  // headers, or controls. Deployment validation also checks binding restrictions.
  return typeof value === 'string' && value.length <= 254
    && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)
    && value.slice(0, value.indexOf('@')).length <= 64
    && !value.startsWith('.') && !value.includes('..') && !value.includes('.@')
    && value.slice(value.indexOf('@') + 1).split('.').every(label => label.length <= 63);
}
export function resolveOperationAlerts(env: OperationAlertsEnv): OperationAlertsConfig | null {
  if (env.OPS_ALERTS_ENABLED === undefined || env.OPS_ALERTS_ENABLED === 'false') return null;
  if (env.OPS_ALERTS_ENABLED !== 'true' || !env.OPS_EMAIL || typeof env.OPS_EMAIL.send !== 'function'
    || !isSingleAddress(env.OPS_ALERT_FROM) || !isSingleAddress(env.OPS_ALERT_TO)) {
    throw new Error('OPERATION_ALERT_CONFIG_INVALID');
  }
  return { binding: env.OPS_EMAIL, from: env.OPS_ALERT_FROM, to: env.OPS_ALERT_TO };
}

// Only errors documented as rejecting the request before delivery are definite
// refusals. Other exceptions, timeouts, malformed responses, or isolate crashes
// have an unknown outcome and cannot be retried without duplicate-email risk.
const REFUSAL_CODES = new Set([
  'E_VALIDATION_ERROR', 'E_FIELD_MISSING', 'E_TOO_MANY_RECIPIENTS', 'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED', 'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_CONTENT_TOO_LARGE', 'E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED',
  'E_HEADER_MISSING', 'E_HEADER_INVALID', 'E_HEADER_CONFLICT',
]);
function refusal(error: unknown): boolean {
  try {
    return typeof error === 'object' && error !== null && 'code' in error
      && typeof error.code === 'string' && REFUSAL_CODES.has(error.code);
  } catch { return false; }
}

/** No dynamic provider/database text or source/customer identifiers enter mail. */
const RECOVERY_GUIDANCE: Readonly<Record<OperationAlertCode, string>> = {
  ACQUISITION_FAILURE: 'Run pnpm ops status. Inspect closed acquisition failure codes and reviewed provider or rights configuration before retrying.',
  OUTBOX_AGE: 'Run pnpm ops status. Check the ingestion Queue and Hyperdrive, then follow the operations recovery runbook.',
  PUBLICATION_LAG: 'Run pnpm ops status. Check artifact processing and current rights before an audited replay.',
  FAILED_JOBS: 'Run pnpm ops status. Inspect closed failure codes and repair the cause before an audited replay.',
  RIGHTS_EXPIRY: 'Run pnpm ops status. Review terms and decision deadlines; follow the rights review runbook before resuming processing.',
};
function messageFor(claim: OperationAlertClaim, config: OperationAlertsConfig) {
  return {
    from: config.from, to: config.to,
    subject: `Data Foundry ${claim.transition}: ${claim.code}`,
    text: `Data Foundry operational observation\nCode: ${claim.code}\nTransition: ${claim.transition}\nCount: ${claim.count}\nObserved at: ${claim.observedAt}\nAction: ${claim.transition === 'FAILURE' ? RECOVERY_GUIDANCE[claim.code] : 'Confirm recovered counts with pnpm ops status and preserve incident history.'}\n`,
  };
}
async function attempt(claim: OperationAlertClaim, config: OperationAlertsConfig): Promise<OperationAlertOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('OPERATION_EMAIL_TIMEOUT')), 15_000);
    });
    const result = await Promise.race([config.binding.send(messageFor(claim, config)), timeout]);
    // Provider acceptance is distinct from delivery to an inbox. Its opaque ID
    // is checked and immediately discarded, never stored or emitted in logs.
    return typeof result?.messageId === 'string' && result.messageId.length > 0 ? 'ACCEPTED' : 'UNKNOWN';
  } catch (error) { return refusal(error) ? 'FAILED' : 'UNKNOWN'; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function deliverOperationAlerts(store: OperationAlertStore, verticalSlug: string, config: OperationAlertsConfig): Promise<Omit<OperationAlertSummary, 'enabled' | 'transitions'>> {
  let attempted = 0; let accepted = 0; let failed = 0; let unknown = 0;
  for (let index = 0; index < 10; index++) {
    const claim = await store.claim(verticalSlug);
    if (!claim) break;
    attempted++;
    const outcome = await attempt(claim, config);
    // A database failure after provider acceptance leaves a durable SENDING
    // row. The next poll classifies it UNKNOWN instead of sending it again.
    const persisted = await store.finish(claim, outcome);
    if (!persisted || outcome === 'UNKNOWN') unknown++;
    else if (outcome === 'ACCEPTED') accepted++;
    else failed++;
  }
  return { attempted, accepted, failed, unknown };
}

export async function runOperationAlerts(driver: SqlDriver, verticalSlug: string, env: OperationAlertsEnv): Promise<OperationAlertSummary> {
  const config = resolveOperationAlerts(env);
  if (!config) return { enabled: false, transitions: 0, attempted: 0, accepted: 0, failed: 0, unknown: 0 };
  const store = new OperationAlertStore(driver);
  const { transitions } = await store.observe(verticalSlug);
  return { enabled: true, transitions, ...await deliverOperationAlerts(store, verticalSlug, config) };
}
