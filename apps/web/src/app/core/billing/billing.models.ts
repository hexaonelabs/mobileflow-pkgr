export type Plan = 'free' | 'starter' | 'pro' | 'enterprise';

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled';

export interface SubscriptionSummary {
  plan: Plan;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
}

export interface CheckoutSessionResult {
  url: string;
}

export interface PortalSessionResult {
  url: string;
}
