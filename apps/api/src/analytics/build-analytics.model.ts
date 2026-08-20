import type { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const ANALYTICS_COLLECTION = 'analytics';

export interface BuildAnalyticsDocument {
  userId: string;
  projectId: string;

  // Agrégation mensuelle
  year: number;
  month: number;

  // Totaux
  totalBuilds: number;
  totalSuccessful: number;
  totalFailed: number;
  totalCancelled: number;

  // Par plateforme
  byPlatform: {
    ios: { total: number; successful: number };
    android: { total: number; successful: number };
  };

  // Par environnement
  byEnvironment: {
    staging: { total: number; successful: number };
    production: { total: number; successful: number };
  };

  // Répartition journalière (30 derniers jours, pour les tendances)
  dailyBreakdown: Array<{
    date: string; // YYYY-MM-DD
    total: number;
    successful: number;
    avgDurationSeconds: number;
  }>;

  // Statistiques globales
  avgDurationSeconds: number;
  successRate: number; // 0-100

  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// DTOs pour les réponses API
export interface AnalyticsSummaryResponse extends Omit<
  BuildAnalyticsDocument,
  'createdAt' | 'updatedAt' | 'dailyBreakdown'
> {
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AnalyticsTrendsResponse {
  months: Array<{
    year: number;
    month: number;
    total: number;
    successful: number;
    successRate: number;
  }>;
}

export interface AnalyticsBreakdownResponse {
  platform: { ios: { count: number; rate: number }; android: { count: number; rate: number } };
  environment: {
    staging: { count: number; rate: number };
    production: { count: number; rate: number };
  };
}
