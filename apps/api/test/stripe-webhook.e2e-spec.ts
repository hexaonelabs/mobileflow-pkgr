import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import type Stripe from 'stripe';
import { BillingPlanMapping } from '../src/billing/billing-plan.mapping';
import { BillingService } from '../src/billing/billing.service';
import { StripeWebhookController } from '../src/billing/stripe-webhook.controller';
import { StripeWebhookService } from '../src/billing/stripe-webhook.service';
import { FirestoreService } from '../src/firestore/firestore.service';
import { Plan, SubscriptionStatus } from '../src/users/user.model';
import { FakeFirestoreDb } from './support/fake-firestore';
import { createFakeStripeClient, type FakeStripeClient } from './support/fake-stripe';

const FREE_PRICE = 'price_free';
const STARTER_PRICE = 'price_starter';

let mockStripeClient: FakeStripeClient;
jest.mock('stripe', () => {
  const actual = jest.requireActual<typeof import('stripe')>('stripe');
  const ctor = jest.fn().mockImplementation(() => mockStripeClient);
  (ctor as unknown as { errors: typeof actual.errors }).errors = actual.errors;
  return ctor;
});

function fakeConfigService(): ConfigService {
  const values: Record<string, string> = {
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_FREE: FREE_PRICE,
    STRIPE_PRICE_STARTER: STARTER_PRICE,
    FRONTEND_URL: 'https://app.mobileflow.test',
  };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) throw new Error(`missing config ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;
}

function subscription(
  overrides: Partial<Stripe.Subscription> & { id: string },
): Stripe.Subscription {
  return {
    customer: 'cus_1',
    status: 'active',
    items: { data: [{ price: { id: FREE_PRICE }, current_period_end: 1_800_000_000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe('POST /stripe/webhook (e2e)', () => {
  let app: INestApplication<App>;
  let db: FakeFirestoreDb;

  beforeEach(async () => {
    mockStripeClient = createFakeStripeClient();
    db = new FakeFirestoreDb();
    db.seed('users', 'user1', {
      email: 'a@b.com',
      authProvider: 'email',
      passwordHash: null,
      githubInstallationId: null,
      plan: Plan.free,
      billing: {
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_free',
        status: SubscriptionStatus.active,
        currentPeriodEnd: null,
      },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        StripeWebhookService,
        BillingService,
        BillingPlanMapping,
        { provide: FirestoreService, useValue: { db } },
        { provide: ConfigService, useValue: fakeConfigService() },
      ],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function post(event: Stripe.Event) {
    mockStripeClient.webhooks.constructEvent.mockReturnValue(event);
    return request(app.getHttpServer())
      .post('/stripe/webhook')
      .set('stripe-signature', 't=1,v1=whatever')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
  }

  it('rejects a request with an invalid signature before touching Firestore', async () => {
    mockStripeClient.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });

    const response = await request(app.getHttpServer())
      .post('/stripe/webhook')
      .set('stripe-signature', 'invalid')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(401);
    expect(db.getRaw('users', 'user1')?.plan).toBe(Plan.free);
  });

  it('checkout.session.completed upgrades the user to starter and cancels the old free subscription', async () => {
    mockStripeClient.subscriptions.retrieve.mockResolvedValue(
      subscription({
        id: 'sub_starter',
        items: { data: [{ price: { id: STARTER_PRICE }, current_period_end: 1_900_000_000 }] },
      } as Partial<Stripe.Subscription>),
    );
    mockStripeClient.subscriptions.cancel.mockResolvedValue({});

    const response = await post({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', customer: 'cus_1', subscription: 'sub_starter' } },
    } as unknown as Stripe.Event);

    expect(response.status).toBe(201);
    const user = db.getRaw('users', 'user1');
    expect(user?.plan).toBe(Plan.starter);
    expect((user?.billing as { stripeSubscriptionId: string })?.stripeSubscriptionId).toBe(
      'sub_starter',
    );
    expect(mockStripeClient.subscriptions.cancel).toHaveBeenCalledWith('sub_free');
  });

  it('customer.subscription.deleted on the current subscription recreates a free subscription', async () => {
    db.seed('users', 'user2', {
      email: 'c@d.com',
      authProvider: 'email',
      passwordHash: null,
      githubInstallationId: null,
      plan: Plan.starter,
      billing: {
        stripeCustomerId: 'cus_2',
        stripeSubscriptionId: 'sub_starter_2',
        status: SubscriptionStatus.active,
        currentPeriodEnd: null,
      },
    });
    mockStripeClient.subscriptions.create.mockResolvedValue(
      subscription({ id: 'sub_free_new', customer: 'cus_2' }),
    );

    const response = await post({
      id: 'evt_2',
      type: 'customer.subscription.deleted',
      data: {
        object: subscription({ id: 'sub_starter_2', customer: 'cus_2', status: 'canceled' }),
      },
    } as unknown as Stripe.Event);

    expect(response.status).toBe(201);
    const user = db.getRaw('users', 'user2');
    expect(user?.plan).toBe(Plan.free);
    expect((user?.billing as { stripeSubscriptionId: string })?.stripeSubscriptionId).toBe(
      'sub_free_new',
    );
    expect(mockStripeClient.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_2', items: [{ price: FREE_PRICE }] }),
    );
  });

  it('ignores subscription.deleted events for a subscription that already got replaced', async () => {
    // user1 est déjà sur sub_free (seed initiale) : un event "deleted" pour une ancienne
    // subscription différente (ex: livré en retard après un upgrade) ne doit rien changer.
    const response = await post({
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: {
        object: subscription({ id: 'sub_stale', customer: 'cus_1', status: 'canceled' }),
      },
    } as unknown as Stripe.Event);

    expect(response.status).toBe(201);
    const user = db.getRaw('users', 'user1');
    expect(user?.plan).toBe(Plan.free);
    expect((user?.billing as { stripeSubscriptionId: string })?.stripeSubscriptionId).toBe(
      'sub_free',
    );
    expect(mockStripeClient.subscriptions.create).not.toHaveBeenCalled();
  });
});
