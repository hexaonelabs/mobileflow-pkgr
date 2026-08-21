import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Plan } from '../users/user.model';

export type BillablePlan = typeof Plan.free | typeof Plan.starter;

// Scope de ce lot : uniquement free + starter (pro/enterprise n'ont pas encore de Price Stripe).
@Injectable()
export class BillingPlanMapping {
  private readonly planToPriceId: Record<BillablePlan, string>;
  private readonly priceIdToPlan: Record<string, BillablePlan>;

  constructor(config: ConfigService) {
    const free = config.getOrThrow<string>('STRIPE_PRICE_FREE');
    const starter = config.getOrThrow<string>('STRIPE_PRICE_STARTER');
    this.planToPriceId = { [Plan.free]: free, [Plan.starter]: starter };
    this.priceIdToPlan = { [free]: Plan.free, [starter]: Plan.starter };
  }

  priceIdFor(plan: BillablePlan): string {
    return this.planToPriceId[plan];
  }

  planForPriceId(priceId: string): BillablePlan | undefined {
    return this.priceIdToPlan[priceId];
  }
}
