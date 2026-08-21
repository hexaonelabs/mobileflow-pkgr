// Mock minimal du client Stripe (customers/subscriptions/checkout/billingPortal/webhooks)
// pour piloter BillingService/StripeWebhookService en test sans appeler l'API Stripe.
// BillingService instancie `new Stripe(...)` directement dans son constructeur (pas de DI
// pour le SDK tiers) : chaque spec doit donc `jest.mock('stripe', ...)` et réassigner
// `mockStripeClient` dans un `beforeEach` — voir billing.service.spec.ts pour l'usage.

export interface FakeStripeClient {
  customers: { create: jest.Mock };
  subscriptions: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  webhooks: { constructEvent: jest.Mock };
}

export function createFakeStripeClient(): FakeStripeClient {
  return {
    customers: { create: jest.fn() },
    subscriptions: { create: jest.fn(), retrieve: jest.fn(), cancel: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    webhooks: { constructEvent: jest.fn() },
  };
}
