import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import type { Plan } from '../users/user.model';
import {
  DEFAULT_PLAN_QUOTAS,
  PLAN_QUOTAS_COLLECTION,
  PLAN_QUOTAS_DOC_ID,
  type PlanQuotasDocument,
} from './plan-quotas.model';

@Injectable()
export class QuotasService {
  constructor(private readonly firestore: FirestoreService) {}

  // Auto-seed au premier appel plutôt qu'une étape manuelle de config Firestore — même idiome
  // que BillingService.requireBilling() qui rattrape un état manquant à la volée.
  async getProjectsLimit(plan: Plan): Promise<number | null> {
    const ref = this.firestore.db.collection(PLAN_QUOTAS_COLLECTION).doc(PLAN_QUOTAS_DOC_ID);
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set(DEFAULT_PLAN_QUOTAS);
      return DEFAULT_PLAN_QUOTAS[plan].projectsLimit;
    }
    const data = doc.data() as PlanQuotasDocument;
    return data[plan]?.projectsLimit ?? null;
  }
}
