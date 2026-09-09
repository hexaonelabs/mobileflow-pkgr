import { Plan } from '../users/user.model';

export const PLAN_QUOTAS_COLLECTION = 'planQuotas';
export const PLAN_QUOTAS_DOC_ID = 'default';

interface PlanQuota {
  projectsLimit: number | null;
  // Rétention des artefacts staging hébergés (OTA) avant suppression auto. null = illimité.
  artifactRetentionDays: number | null;
  // Profondeur d'historique visible sur la page analytics. 1 = mois courant uniquement,
  // null = tout l'historique (agrégation de tous les documents mensuels du projet).
  analyticsHistoryMonths: number | null;
}

export interface PlanQuotasDocument {
  [Plan.free]: PlanQuota;
  [Plan.starter]: PlanQuota;
  [Plan.pro]: PlanQuota;
  [Plan.enterprise]: PlanQuota;
}

// null = illimité. pro/enterprise à null par défaut : pas encore vendus (aucun produit Stripe).
export const DEFAULT_PLAN_QUOTAS: PlanQuotasDocument = {
  [Plan.free]: { projectsLimit: 1, artifactRetentionDays: 7, analyticsHistoryMonths: 1 },
  [Plan.starter]: { projectsLimit: 5, artifactRetentionDays: 30, analyticsHistoryMonths: null },
  [Plan.pro]: { projectsLimit: null, artifactRetentionDays: 90, analyticsHistoryMonths: null },
  [Plan.enterprise]: {
    projectsLimit: null,
    artifactRetentionDays: null,
    analyticsHistoryMonths: null,
  },
};
