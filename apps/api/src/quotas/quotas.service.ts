import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { Plan } from '../users/user.model';
import {
  DEFAULT_PLAN_QUOTAS,
  PLAN_QUOTAS_COLLECTION,
  PLAN_QUOTAS_DOC_ID,
  type PlanQuotasDocument,
} from './plan-quotas.model';

@Injectable()
export class QuotasService {
  constructor(private readonly firestore: FirestoreService) {}

  async getProjectsLimit(plan: Plan): Promise<number | null> {
    const quotas = await this.getQuotas();
    return quotas[plan]?.projectsLimit ?? null;
  }

  async getArtifactRetentionDays(plan: Plan): Promise<number | null> {
    const quotas = await this.getQuotas();
    return quotas[plan]?.artifactRetentionDays ?? null;
  }

  async getAnalyticsHistoryMonths(plan: Plan): Promise<number | null> {
    const quotas = await this.getQuotas();
    return quotas[plan]?.analyticsHistoryMonths ?? null;
  }

  // Auto-seed au premier appel plutôt qu'une étape manuelle de config Firestore — même idiome
  // que BillingService.requireBilling() qui rattrape un état manquant à la volée.
  // Merge avec DEFAULT_PLAN_QUOTAS par plan : un doc déjà existant (créé avant l'ajout d'un
  // nouveau champ de quota) ne doit pas faire retomber ce champ à `undefined`.
  private async getQuotas(): Promise<PlanQuotasDocument> {
    const ref = this.firestore.db.collection(PLAN_QUOTAS_COLLECTION).doc(PLAN_QUOTAS_DOC_ID);
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set(DEFAULT_PLAN_QUOTAS);
      return DEFAULT_PLAN_QUOTAS;
    }
    const stored = doc.data() as Partial<PlanQuotasDocument>;
    return {
      [Plan.free]: { ...DEFAULT_PLAN_QUOTAS[Plan.free], ...stored[Plan.free] },
      [Plan.starter]: { ...DEFAULT_PLAN_QUOTAS[Plan.starter], ...stored[Plan.starter] },
      [Plan.pro]: { ...DEFAULT_PLAN_QUOTAS[Plan.pro], ...stored[Plan.pro] },
      [Plan.enterprise]: { ...DEFAULT_PLAN_QUOTAS[Plan.enterprise], ...stored[Plan.enterprise] },
    };
  }
}
