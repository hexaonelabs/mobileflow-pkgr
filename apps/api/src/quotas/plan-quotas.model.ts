import { Plan } from '../users/user.model';

export const PLAN_QUOTAS_COLLECTION = 'planQuotas';
export const PLAN_QUOTAS_DOC_ID = 'default';

interface PlanQuota {
  projectsLimit: number | null;
  // Rétention des artefacts staging hébergés (OTA) avant suppression auto. null = illimité.
  artifactRetentionDays: number | null;
}

export interface PlanQuotasDocument {
  [Plan.free]: PlanQuota;
  [Plan.starter]: PlanQuota;
  [Plan.pro]: PlanQuota;
  [Plan.enterprise]: PlanQuota;
}

// null = illimité. pro/enterprise à null par défaut : pas encore vendus (aucun produit Stripe).
export const DEFAULT_PLAN_QUOTAS: PlanQuotasDocument = {
  [Plan.free]: { projectsLimit: 1, artifactRetentionDays: 7 },
  [Plan.starter]: { projectsLimit: 5, artifactRetentionDays: 30 },
  [Plan.pro]: { projectsLimit: null, artifactRetentionDays: 90 },
  [Plan.enterprise]: { projectsLimit: null, artifactRetentionDays: null },
};
