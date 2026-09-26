/**
 * The purchasable plan catalogue for one vertical deployment.
 *
 * Prices and allowances come from the vertical's compiled `product.yaml`
 * (the same values the public pricing page shows). The provider price id for
 * each paid plan is deployment configuration (`STRIPE_PRICE_IDS`), because a
 * sandbox and a live account have different ids for the same plan.
 */

export interface ProductPlan {
  readonly name: string;
  readonly monthly_usd: number;
  readonly included_requests: number;
}

export interface PurchasablePlan {
  /** Stable lowercase code derived from the plan name, e.g. `developer`. */
  readonly code: string;
  readonly name: string;
  readonly monthlyUsd: number;
  readonly includedRequests: number;
  readonly providerPriceId: string;
}

export class BillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingConfigurationError';
  }
}

const PLAN_CODE = /^[a-z][a-z0-9_-]{0,62}$/;
const STRIPE_PRICE_ID = /^price_[A-Za-z0-9]{8,255}$/;

export function planCode(name: string): string {
  const code = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!PLAN_CODE.test(code)) throw new BillingConfigurationError(`Plan name "${name}" has no valid code.`);
  return code;
}

/**
 * Parses `STRIPE_PRICE_IDS` (`{"developer":"price_...", ...}`) against the
 * product's plans. Every paid plan must have a price id and no id may name a
 * plan the product does not publish; a free plan is never sold through
 * Checkout. Any mismatch is a configuration error, never a silent omission.
 */
export function resolvePurchasablePlans(
  plans: readonly ProductPlan[],
  priceIdsJson: string | undefined,
): readonly PurchasablePlan[] {
  if (priceIdsJson === undefined || priceIdsJson.trim() === '') {
    throw new BillingConfigurationError('STRIPE_PRICE_IDS is not configured.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(priceIdsJson);
  } catch {
    throw new BillingConfigurationError('STRIPE_PRICE_IDS is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BillingConfigurationError('STRIPE_PRICE_IDS must be a JSON object.');
  }
  const priceIds = parsed as Record<string, unknown>;
  const paid = plans.filter((plan) => plan.monthly_usd > 0);
  const known = new Set(paid.map((plan) => planCode(plan.name)));
  for (const code of Object.keys(priceIds)) {
    if (!known.has(code)) {
      throw new BillingConfigurationError(`STRIPE_PRICE_IDS names unknown paid plan "${code}".`);
    }
  }
  return paid.map((plan) => {
    const code = planCode(plan.name);
    const priceId = priceIds[code];
    if (typeof priceId !== 'string' || !STRIPE_PRICE_ID.test(priceId)) {
      throw new BillingConfigurationError(`STRIPE_PRICE_IDS has no valid price for plan "${code}".`);
    }
    if (!Number.isInteger(plan.included_requests) || plan.included_requests <= 0) {
      throw new BillingConfigurationError(`Plan "${code}" has no positive request allowance.`);
    }
    return {
      code,
      name: plan.name,
      monthlyUsd: plan.monthly_usd,
      includedRequests: plan.included_requests,
      providerPriceId: priceId,
    };
  });
}

export function findPlanByCode(
  plans: readonly PurchasablePlan[],
  code: string,
): PurchasablePlan | null {
  return plans.find((plan) => plan.code === code) ?? null;
}

export function findPlanByPriceId(
  plans: readonly PurchasablePlan[],
  priceId: string,
): PurchasablePlan | null {
  return plans.find((plan) => plan.providerPriceId === priceId) ?? null;
}
