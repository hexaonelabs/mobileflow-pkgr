import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingPlanMapping } from './billing-plan.mapping';
import { BillingService } from './billing.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService, BillingPlanMapping, StripeWebhookService],
  exports: [BillingService],
})
export class BillingModule {}
