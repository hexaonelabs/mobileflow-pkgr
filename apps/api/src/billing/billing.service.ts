import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import { FirestoreService } from '../firestore/firestore.service';
import {
  SubscriptionStatus,
  USERS_COLLECTION,
  type SubscriptionStatus as SubscriptionStatusType,
  type UserBilling,
  type UserDocument,
} from '../users/user.model';
import { BillingPlanMapping, type BillablePlan } from './billing-plan.mapping';

export interface SubscriptionSummary {
  plan: string;
  status: SubscriptionStatusType | null;
  currentPeriodEnd: string | null;
}

// Un statut Stripe non mappé (trialing, incomplete, unpaid...) est traité comme past_due :
// aucun de ces statuts n'est atteignable avec la config actuelle (pas d'essai, paiement
// immédiat requis sur starter), donc le mapping par défaut sert de filet de sécurité.
const STRIPE_STATUS_MAPPING: Record<string, SubscriptionStatusType> = {
  active: SubscriptionStatus.active,
  past_due: SubscriptionStatus.pastDue,
  canceled: SubscriptionStatus.canceled,
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  readonly stripe: Stripe;
  private readonly frontendUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly firestore: FirestoreService,
    private readonly planMapping: BillingPlanMapping,
  ) {
    this.stripe = new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'));
    this.frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
  }

  private get users() {
    return this.firestore.db.collection(USERS_COLLECTION);
  }

  // Appelé à l'inscription : donne à chaque utilisateur un Customer + une Subscription
  // Stripe dès le départ (même sur le plan free à 0€), pour qu'un seul pipeline webhook
  // gère tous les changements de plan par la suite (cf. plan de dev, décision actée).
  async provisionCustomer(userId: string, email: string): Promise<UserBilling> {
    const customer = await this.stripe.customers.create({ email, metadata: { userId } });
    const subscription = await this.stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: this.planMapping.priceIdFor('free') }],
      metadata: { userId },
    });

    const billing = this.toUserBilling(subscription);
    await this.users
      .doc(userId)
      .update({ plan: 'free', billing, updatedAt: FieldValue.serverTimestamp() });
    return billing;
  }

  async createCheckoutSession(userId: string, targetPlan: BillablePlan): Promise<{ url: string }> {
    const billing = await this.requireBilling(userId);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: billing.stripeCustomerId,
      line_items: [{ price: this.planMapping.priceIdFor(targetPlan), quantity: 1 }],
      success_url: `${this.frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.frontendUrl}/billing/cancel`,
    });
    if (!session.url) {
      throw new Error("Stripe n'a pas retourné d'URL de Checkout.");
    }
    return { url: session.url };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const billing = await this.requireBilling(userId);
    const session = await this.stripe.billingPortal.sessions.create({
      customer: billing.stripeCustomerId,
      return_url: `${this.frontendUrl}/billing`,
    });
    return { url: session.url };
  }

  async getSubscriptionSummary(userId: string): Promise<SubscriptionSummary> {
    const data = await this.getUserDocument(userId);
    return {
      plan: data.plan,
      status: data.billing?.status ?? null,
      currentPeriodEnd: data.billing?.currentPeriodEnd?.toDate().toISOString() ?? null,
    };
  }

  async findUserIdByCustomerId(customerId: string): Promise<string> {
    const snapshot = await this.users
      .where('billing.stripeCustomerId', '==', customerId)
      .limit(1)
      .get();
    if (snapshot.empty) {
      throw new NotFoundException(`Aucun utilisateur pour le customer Stripe ${customerId}.`);
    }
    return snapshot.docs[0].id;
  }

  async getBilling(userId: string): Promise<UserBilling | undefined> {
    const data = await this.getUserDocument(userId);
    return data.billing;
  }

  // Écrase l'état plan/billing à partir d'un objet Stripe Subscription. Idempotent par
  // construction (écrase un état plutôt que d'incrémenter un compteur) : recevoir le même
  // event Stripe deux fois n'a pas d'effet de bord.
  async persistSubscriptionState(userId: string, subscription: Stripe.Subscription): Promise<void> {
    const billing = this.toUserBilling(subscription);
    const priceId = subscription.items.data[0]?.price.id;
    const plan = priceId ? this.planMapping.planForPriceId(priceId) : undefined;
    if (!plan) {
      this.logger.warn(
        `Subscription ${subscription.id} référence un price ${priceId} inconnu du mapping billing, plan non mis à jour.`,
      );
      await this.users.doc(userId).update({ billing, updatedAt: FieldValue.serverTimestamp() });
      return;
    }
    await this.users.doc(userId).update({ plan, billing, updatedAt: FieldValue.serverTimestamp() });
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        // Déjà annulée (ex: webhook livré deux fois) — pas une erreur.
        this.logger.debug(`Subscription ${subscriptionId} déjà annulée, ignoré.`);
        return;
      }
      throw error;
    }
  }

  async createFreeSubscriptionForCustomer(customerId: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: this.planMapping.priceIdFor('free') }],
    });
  }

  private async requireBilling(userId: string): Promise<UserBilling> {
    const data = await this.getUserDocument(userId);
    if (data.billing) {
      return data.billing;
    }
    // Le provisioning à l'inscription peut avoir échoué (appel Stripe non bloquant) : on
    // rattrape ici plutôt que de bloquer l'utilisateur.
    return this.provisionCustomer(userId, data.email);
  }

  private async getUserDocument(userId: string): Promise<UserDocument> {
    const doc = await this.users.doc(userId).get();
    const data = doc.data() as UserDocument | undefined;
    if (!doc.exists || !data) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    return data;
  }

  private toUserBilling(subscription: Stripe.Subscription): UserBilling {
    const item = subscription.items.data[0];
    return {
      stripeCustomerId:
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
      status: STRIPE_STATUS_MAPPING[subscription.status] ?? SubscriptionStatus.pastDue,
      currentPeriodEnd: Timestamp.fromMillis(item.current_period_end * 1000),
    };
  }
}
