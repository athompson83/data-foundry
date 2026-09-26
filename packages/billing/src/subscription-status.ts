/**
 * How a provider subscription status maps onto what the platform stores and
 * whether the tenant may keep calling the API.
 *
 * `past_due` keeps access: Stripe is still retrying the card, and cutting a
 * machine client off at the first failed charge turns a declined card into an
 * outage. Access stops once Stripe gives up (`unpaid`/`canceled`) or the
 * subscription is paused or never completed.
 */
export type StoredSubscriptionStatus =
  | 'INCOMPLETE'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'UNPAID'
  | 'CANCELED'
  | 'PAUSED';

const STATUS_MAP: Readonly<Record<string, StoredSubscriptionStatus>> = {
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELED',
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'UNPAID',
  canceled: 'CANCELED',
  paused: 'PAUSED',
};

export function storedSubscriptionStatus(providerStatus: string): StoredSubscriptionStatus | null {
  return STATUS_MAP[providerStatus] ?? null;
}

export function subscriptionGrantsAccess(status: StoredSubscriptionStatus): boolean {
  return status === 'ACTIVE' || status === 'TRIALING' || status === 'PAST_DUE';
}
