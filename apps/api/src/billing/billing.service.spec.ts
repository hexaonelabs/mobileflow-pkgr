import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { createFakeStripeClient, type FakeStripeClient } from '../../test/support/fake-stripe';
import type { FirestoreService } from '../firestore/firestore.service';
import { Plan, SubscriptionStatus, type UserDocument } from '../users/user.model';
import { BillingPlanMapping } from './billing-plan.mapping';
import { BillingService } from './billing.service';

let mockStripeClient: FakeStripeClient;
jest.mock('stripe', () => {
  const actual = jest.requireActual<typeof import('stripe')>('stripe');
  const ctor = jest.fn().mockImplementation(() => mockStripeClient);
  (ctor as unknown as { errors: typeof actual.errors }).errors = actual.errors;
  return ctor;
});

const FREE_PRICE = 'price_free';
const STARTER_PRICE = 'price_starter';
const FRONTEND_URL = 'https://app.mobileflow.test';

function fakeConfig(): ConfigService {
  const values: Record<string, string> = {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_FREE: FREE_PRICE,
    STRIPE_PRICE_STARTER: STARTER_PRICE,
    FRONTEND_URL,
  };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) throw new Error(`missing config ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;
}

function fakeFirestore() {
  const store = new Map<string, UserDocument>();

  const usersRoot = {
    doc: (id: string) => ({
      get: () => Promise.resolve({ exists: store.has(id), data: () => store.get(id), id }),
      update: (patch: Partial<UserDocument>) => {
        const current = store.get(id);
        if (!current) throw new Error(`fake user ${id} not found`);
        store.set(id, { ...current, ...patch });
        return Promise.resolve();
      },
    }),
    where: (field: string, _op: '==', value: unknown) => {
      const filtered = [...store.entries()].filter(
        ([, data]) =>
          (data.billing as Record<string, unknown> | undefined)?.[field.split('.')[1]] === value,
      );
      return {
        limit: (n: number) => ({
          get: () =>
            Promise.resolve({
              empty: filtered.length === 0,
              docs: filtered.slice(0, n).map(([id, data]) => ({ id, data: () => data })),
            }),
        }),
      };
    },
  };

  const db = { collection: jest.fn(() => usersRoot) };
  return { db: db as unknown as FirestoreService['db'], store };
}

function fakeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    items: {
      data: [
        {
          price: { id: FREE_PRICE },
          current_period_end: 1_800_000_000,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe('BillingService', () => {
  beforeEach(() => {
    mockStripeClient = createFakeStripeClient();
  });

  function createService(firestore: ReturnType<typeof fakeFirestore>) {
    const planMapping = new BillingPlanMapping(fakeConfig());
    return new BillingService(fakeConfig(), firestore, planMapping);
  }

  it('provisionCustomer creates a Stripe customer + free subscription and stores it', async () => {
    const firestore = fakeFirestore();
    firestore.store.set('user1', {
      email: 'a@b.com',
      authProvider: 'email',
      passwordHash: null,
      githubInstallationId: null,
      plan: Plan.free,
    } as UserDocument);
    mockStripeClient.customers.create.mockResolvedValue({ id: 'cus_1' });
    mockStripeClient.subscriptions.create.mockResolvedValue(fakeSubscription());

    const service = createService(firestore);
    const billing = await service.provisionCustomer('user1', 'a@b.com');

    expect(mockStripeClient.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.com' }),
    );
    expect(mockStripeClient.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', items: [{ price: FREE_PRICE }] }),
    );
    expect(billing.stripeCustomerId).toBe('cus_1');
    expect(billing.stripeSubscriptionId).toBe('sub_1');
    expect(billing.status).toBe(SubscriptionStatus.active);
    expect(firestore.store.get('user1')?.plan).toBe(Plan.free);
  });

  it('createCheckoutSession uses the stored customer id and the starter price', async () => {
    const firestore = fakeFirestore();
    firestore.store.set('user1', {
      email: 'a@b.com',
      plan: Plan.free,
      billing: {
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        status: SubscriptionStatus.active,
        currentPeriodEnd: {} as never,
      },
    } as UserDocument);
    mockStripeClient.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.test/x',
    });

    const service = createService(firestore);
    const result = await service.createCheckoutSession('user1', Plan.starter);

    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_1',
        line_items: [{ price: STARTER_PRICE, quantity: 1 }],
        success_url: expect.stringContaining(`${FRONTEND_URL}/billing/success`) as string,
        cancel_url: `${FRONTEND_URL}/billing/cancel`,
      }),
    );
    expect(result).toEqual({ url: 'https://checkout.stripe.test/x' });
  });

  it('createCheckoutSession lazily provisions billing when it is missing', async () => {
    const firestore = fakeFirestore();
    firestore.store.set('user1', { email: 'a@b.com', plan: Plan.free } as UserDocument);
    mockStripeClient.customers.create.mockResolvedValue({ id: 'cus_new' });
    mockStripeClient.subscriptions.create.mockResolvedValue(
      fakeSubscription({ id: 'sub_new', customer: 'cus_new' }),
    );
    mockStripeClient.checkout.sessions.create.mockResolvedValue({
      url: 'https://checkout.stripe.test/y',
    });

    const service = createService(firestore);
    await service.createCheckoutSession('user1', Plan.starter);

    expect(mockStripeClient.customers.create).toHaveBeenCalledTimes(1);
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_new' }),
    );
  });

  it('createPortalSession returns the portal url for the stored customer', async () => {
    const firestore = fakeFirestore();
    firestore.store.set('user1', {
      email: 'a@b.com',
      plan: Plan.starter,
      billing: {
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        status: SubscriptionStatus.active,
        currentPeriodEnd: {} as never,
      },
    } as UserDocument);
    mockStripeClient.billingPortal.sessions.create.mockResolvedValue({
      url: 'https://portal.stripe.test/x',
    });

    const service = createService(firestore);
    const result = await service.createPortalSession('user1');

    expect(mockStripeClient.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_1', return_url: `${FRONTEND_URL}/billing` }),
    );
    expect(result).toEqual({ url: 'https://portal.stripe.test/x' });
  });

  it('findUserIdByCustomerId throws NotFoundException when no user matches', async () => {
    const firestore = fakeFirestore();
    const service = createService(firestore);

    await expect(service.findUserIdByCustomerId('cus_missing')).rejects.toThrow(NotFoundException);
  });

  it('persistSubscriptionState maps the price id to a plan and overwrites plan+billing', async () => {
    const firestore = fakeFirestore();
    firestore.store.set('user1', { email: 'a@b.com', plan: Plan.free } as UserDocument);
    const service = createService(firestore);

    await service.persistSubscriptionState(
      'user1',
      fakeSubscription({
        id: 'sub_starter',
        items: { data: [{ price: { id: STARTER_PRICE }, current_period_end: 1_800_000_000 }] },
      } as Partial<Stripe.Subscription>),
    );

    expect(firestore.store.get('user1')?.plan).toBe(Plan.starter);
    expect(firestore.store.get('user1')?.billing?.stripeSubscriptionId).toBe('sub_starter');
  });

  it('cancelSubscription silently ignores an already-canceled subscription', async () => {
    const actualStripe = jest.requireActual<typeof import('stripe')>('stripe');
    mockStripeClient.subscriptions.cancel.mockRejectedValue(
      new actualStripe.errors.StripeInvalidRequestError({ message: 'already canceled' }),
    );
    const service = createService(fakeFirestore());

    await expect(service.cancelSubscription('sub_1')).resolves.toBeUndefined();
  });

  it('cancelSubscription rethrows unexpected errors', async () => {
    mockStripeClient.subscriptions.cancel.mockRejectedValue(new Error('network error'));
    const service = createService(fakeFirestore());

    await expect(service.cancelSubscription('sub_1')).rejects.toThrow('network error');
  });
});
