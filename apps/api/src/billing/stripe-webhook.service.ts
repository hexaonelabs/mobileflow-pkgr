import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { BillingService } from './billing.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly config: ConfigService,
  ) {}

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
    try {
      return this.billingService.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new UnauthorizedException('Signature Stripe invalide.');
    }
  }

  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object);
        return;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object);
        return;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object);
        return;
      default:
        return;
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!customerId || !subscriptionId) {
      this.logger.warn(`Checkout session ${session.id} sans customer/subscription, ignoré.`);
      return;
    }

    const userId = await this.billingService.findUserIdByCustomerId(customerId);
    const previousBilling = await this.billingService.getBilling(userId);
    const subscription = await this.billingService.stripe.subscriptions.retrieve(subscriptionId);

    await this.billingService.persistSubscriptionState(userId, subscription);

    // L'utilisateur avait déjà une subscription (le plan free à 0€, cf. provisionCustomer) :
    // on l'annule pour garder l'invariant "une seule subscription active par customer".
    if (previousBilling && previousBilling.stripeSubscriptionId !== subscription.id) {
      await this.billingService.cancelSubscription(previousBilling.stripeSubscriptionId);
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const userId = await this.billingService.findUserIdByCustomerId(customerId);
    const currentBilling = await this.billingService.getBilling(userId);

    // Ignore les updates sur une ancienne subscription déjà remplacée (ex: l'annulation de
    // l'ex-subscription free déclenchée par handleCheckoutCompleted émet elle-même un event
    // customer.subscription.updated pour CETTE ancienne subscription) : on ne réagit qu'aux
    // updates concernant la subscription actuellement suivie pour cet utilisateur.
    if (currentBilling && currentBilling.stripeSubscriptionId !== subscription.id) {
      return;
    }
    await this.billingService.persistSubscriptionState(userId, subscription);
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const userId = await this.billingService.findUserIdByCustomerId(customerId);
    const currentBilling = await this.billingService.getBilling(userId);

    // Même garde que pour subscription.updated : une subscription déjà remplacée ne doit
    // pas déclencher la recréation d'un plan free (elle a déjà été supplantée par la nouvelle).
    if (currentBilling && currentBilling.stripeSubscriptionId !== subscription.id) {
      return;
    }

    // Invariant : un customer a toujours exactement une subscription active. La subscription
    // payante vient de disparaître (résiliation ou échec de paiement définitif) → on recrée
    // le plan free à 0€ pour ce customer.
    const freeSubscription =
      await this.billingService.createFreeSubscriptionForCustomer(customerId);
    await this.billingService.persistSubscriptionState(userId, freeSubscription);
  }
}
