import { Plan } from '../users/user.model';

export const PLAN_QUOTAS_COLLECTION = 'planQuotas';
export const PLAN_QUOTAS_DOC_ID = 'default';

export interface PlanQuotasDocument {
  [Plan.free]: { projectsLimit: number | null };
  [Plan.starter]: { projectsLimit: number | null };
  [Plan.pro]: { projectsLimit: number | null };
  [Plan.enterprise]: { projectsLimit: number | null };
}

// null = illimité. pro/enterprise à null par défaut : pas encore vendus (aucun produit Stripe).
export const DEFAULT_PLAN_QUOTAS: PlanQuotasDocument = {
  [Plan.free]: { projectsLimit: 1 },
  [Plan.starter]: { projectsLimit: 5 },
  [Plan.pro]: { projectsLimit: null },
  [Plan.enterprise]: { projectsLimit: null },
};
