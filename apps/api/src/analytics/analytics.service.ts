import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { FirestoreService } from '../firestore/firestore.service';
import { PROJECTS_COLLECTION, Platform, type ProjectDocument } from '../projects/project.model';
import { BuildStatus, Environment } from '../builds/build.model';
import { QuotasService } from '../quotas/quotas.service';
import type { Plan } from '../users/user.model';
import {
  ANALYTICS_COLLECTION,
  type AnalyticsBreakdownResponse,
  type AnalyticsSummaryResponse,
  type AnalyticsTrendsResponse,
  type BuildAnalyticsDocument,
} from './build-analytics.model';

const DAILY_BREAKDOWN_DAYS = 30;

type DailyBreakdownEntry = BuildAnalyticsDocument['dailyBreakdown'][number];
type PlatformOrEnvironmentStats = { total: number; successful: number };
type AnalyticsStats = Omit<BuildAnalyticsDocument, 'createdAt' | 'updatedAt' | 'dailyBreakdown'>;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly quotas: QuotasService,
  ) {}

  private get analyticsCollection() {
    return this.firestore.db.collection(ANALYTICS_COLLECTION);
  }

  private async getOwnedProject(userId: string, projectId: string): Promise<ProjectDocument> {
    const doc = await this.firestore.db.collection(PROJECTS_COLLECTION).doc(projectId).get();
    const data = doc.data() as ProjectDocument | undefined;
    if (!doc.exists || !data || data.userId !== userId) {
      throw new NotFoundException('Projet introuvable.');
    }
    return data;
  }

  // Point d'entrée appelé une seule fois par build terminé, depuis
  // BuildsService.finalizeBuildStatus() (webhook ou polling, peu importe qui gagne la course).
  // Toute la lecture-modification-écriture (compteurs ET dailyBreakdown) se fait dans la même
  // transaction Firestore : deux builds qui se terminent la même journée à quelques secondes
  // d'écart ne doivent jamais s'écraser l'un l'autre (cf. commentaire dans PHASE_1_TASKS.md).
  async recordBuild(
    userId: string,
    projectId: string,
    data: {
      platform: Platform;
      environment: Environment;
      status: BuildStatus;
      durationSeconds: number | null;
    },
  ): Promise<void> {
    const { year, month } = this.getCurrentYearMonth();
    const today = this.getCurrentDateString();
    const ref = this.analyticsCollection.doc(
      this.buildAnalyticsDocId(userId, projectId, year, month),
    );
    const isSuccessful = data.status === BuildStatus.success;

    await this.firestore.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists
        ? (snap.data() as BuildAnalyticsDocument)
        : this.emptyDocument(userId, projectId, year, month);

      const totalBuilds = current.totalBuilds + 1;
      const totalSuccessful = current.totalSuccessful + (isSuccessful ? 1 : 0);
      const totalFailed = current.totalFailed + (data.status === BuildStatus.failed ? 1 : 0);
      const totalCancelled =
        current.totalCancelled + (data.status === BuildStatus.cancelled ? 1 : 0);

      const byPlatform = { ...current.byPlatform };
      byPlatform[data.platform] = this.incrementStats(byPlatform[data.platform], isSuccessful);

      const byEnvironment = { ...current.byEnvironment };
      byEnvironment[data.environment] = this.incrementStats(
        byEnvironment[data.environment],
        isSuccessful,
      );

      const dailyBreakdown = this.upsertDailyBreakdown(
        current.dailyBreakdown,
        today,
        isSuccessful,
        data.durationSeconds,
      );

      const previousDurationSum = current.avgDurationSeconds * current.totalBuilds;
      const avgDurationSeconds =
        data.durationSeconds !== null
          ? Math.round((previousDurationSum + data.durationSeconds) / totalBuilds)
          : Math.round(previousDurationSum / totalBuilds);
      const successRate = Math.round((totalSuccessful / totalBuilds) * 1000) / 10;

      const updated: BuildAnalyticsDocument = {
        userId,
        projectId,
        year,
        month,
        totalBuilds,
        totalSuccessful,
        totalFailed,
        totalCancelled,
        byPlatform,
        byEnvironment,
        dailyBreakdown,
        avgDurationSeconds,
        successRate,
        createdAt: current.createdAt,
        updatedAt: FieldValue.serverTimestamp(),
      };

      tx.set(ref, updated);
    });
  }

  async getSummary(
    userId: string,
    projectId: string,
    plan: Plan,
  ): Promise<AnalyticsSummaryResponse> {
    await this.getOwnedProject(userId, projectId);
    const { year, month } = this.getCurrentYearMonth();
    if (await this.isCurrentMonthOnly(plan)) {
      const doc = await this.fetchMonthDocument(userId, projectId, year, month);
      return {
        ...(doc ? this.toStats(doc) : this.emptyStats(userId, projectId, year, month)),
        createdAt: doc ? this.toIsoString(doc.createdAt) : null,
        updatedAt: doc ? this.toIsoString(doc.updatedAt) : null,
      };
    }

    const docs = await this.fetchAllDocuments(userId, projectId);
    return {
      ...this.aggregateStats(userId, projectId, year, month, docs),
      createdAt: null,
      updatedAt: null,
    };
  }

  async getTrends(userId: string, projectId: string, plan: Plan): Promise<AnalyticsTrendsResponse> {
    await this.getOwnedProject(userId, projectId);
    if (await this.isCurrentMonthOnly(plan)) {
      const { year, month } = this.getCurrentYearMonth();
      const stats = await this.getMonthStats(userId, projectId, year, month);
      return {
        months: [
          {
            year,
            month,
            total: stats.totalBuilds,
            successful: stats.totalSuccessful,
            successRate: stats.successRate,
          },
        ],
      };
    }

    const docs = await this.fetchAllDocuments(userId, projectId);
    return {
      months: docs.map((doc) => ({
        year: doc.year,
        month: doc.month,
        total: doc.totalBuilds,
        successful: doc.totalSuccessful,
        successRate: doc.successRate,
      })),
    };
  }

  async getBreakdown(
    userId: string,
    projectId: string,
    plan: Plan,
  ): Promise<AnalyticsBreakdownResponse> {
    await this.getOwnedProject(userId, projectId);
    const { year, month } = this.getCurrentYearMonth();
    const stats = (await this.isCurrentMonthOnly(plan))
      ? await this.getMonthStats(userId, projectId, year, month)
      : this.aggregateStats(userId, projectId, year, month, await this.fetchAllDocuments(userId, projectId));
    return {
      platform: {
        ios: this.toRate(stats.byPlatform.ios),
        android: this.toRate(stats.byPlatform.android),
      },
      environment: {
        staging: this.toRate(stats.byEnvironment.staging),
        production: this.toRate(stats.byEnvironment.production),
      },
    };
  }

  // Free plan : historique limité au mois courant. Autres plans : illimité (all time).
  private async isCurrentMonthOnly(plan: Plan): Promise<boolean> {
    return (await this.quotas.getAnalyticsHistoryMonths(plan)) === 1;
  }

  private async fetchAllDocuments(
    userId: string,
    projectId: string,
  ): Promise<BuildAnalyticsDocument[]> {
    const snap = await this.analyticsCollection
      .where('userId', '==', userId)
      .where('projectId', '==', projectId)
      .get();
    return snap.docs
      .map((doc) => doc.data() as BuildAnalyticsDocument)
      .sort((a, b) => a.year - b.year || a.month - b.month);
  }

  private aggregateStats(
    userId: string,
    projectId: string,
    year: number,
    month: number,
    docs: BuildAnalyticsDocument[],
  ): AnalyticsStats {
    if (docs.length === 0) return this.emptyStats(userId, projectId, year, month);

    const durationSum = docs.reduce((sum, doc) => sum + doc.avgDurationSeconds * doc.totalBuilds, 0);
    const totalBuilds = docs.reduce((sum, doc) => sum + doc.totalBuilds, 0);
    const totalSuccessful = docs.reduce((sum, doc) => sum + doc.totalSuccessful, 0);

    return {
      userId,
      projectId,
      year,
      month,
      totalBuilds,
      totalSuccessful,
      totalFailed: docs.reduce((sum, doc) => sum + doc.totalFailed, 0),
      totalCancelled: docs.reduce((sum, doc) => sum + doc.totalCancelled, 0),
      byPlatform: {
        ios: this.mergePlatformStats(docs.map((doc) => doc.byPlatform.ios)),
        android: this.mergePlatformStats(docs.map((doc) => doc.byPlatform.android)),
      },
      byEnvironment: {
        staging: this.mergePlatformStats(docs.map((doc) => doc.byEnvironment.staging)),
        production: this.mergePlatformStats(docs.map((doc) => doc.byEnvironment.production)),
      },
      avgDurationSeconds: totalBuilds > 0 ? Math.round(durationSum / totalBuilds) : 0,
      successRate: totalBuilds > 0 ? Math.round((totalSuccessful / totalBuilds) * 1000) / 10 : 0,
    };
  }

  private mergePlatformStats(stats: PlatformOrEnvironmentStats[]): PlatformOrEnvironmentStats {
    return stats.reduce(
      (acc, s) => ({ total: acc.total + s.total, successful: acc.successful + s.successful }),
      { total: 0, successful: 0 },
    );
  }

  private async getMonthStats(
    userId: string,
    projectId: string,
    year: number,
    month: number,
  ): Promise<AnalyticsStats> {
    const doc = await this.fetchMonthDocument(userId, projectId, year, month);
    return doc ? this.toStats(doc) : this.emptyStats(userId, projectId, year, month);
  }

  private toStats(doc: BuildAnalyticsDocument): AnalyticsStats {
    return {
      userId: doc.userId,
      projectId: doc.projectId,
      year: doc.year,
      month: doc.month,
      totalBuilds: doc.totalBuilds,
      totalSuccessful: doc.totalSuccessful,
      totalFailed: doc.totalFailed,
      totalCancelled: doc.totalCancelled,
      byPlatform: doc.byPlatform,
      byEnvironment: doc.byEnvironment,
      avgDurationSeconds: doc.avgDurationSeconds,
      successRate: doc.successRate,
    };
  }

  private async fetchMonthDocument(
    userId: string,
    projectId: string,
    year: number,
    month: number,
  ): Promise<BuildAnalyticsDocument | null> {
    const doc = await this.analyticsCollection
      .doc(this.buildAnalyticsDocId(userId, projectId, year, month))
      .get();
    return doc.exists ? (doc.data() as BuildAnalyticsDocument) : null;
  }

  private incrementStats(
    stats: PlatformOrEnvironmentStats,
    isSuccessful: boolean,
  ): PlatformOrEnvironmentStats {
    return { total: stats.total + 1, successful: stats.successful + (isSuccessful ? 1 : 0) };
  }

  private upsertDailyBreakdown(
    breakdown: DailyBreakdownEntry[],
    date: string,
    isSuccessful: boolean,
    durationSeconds: number | null,
  ): DailyBreakdownEntry[] {
    const existingIndex = breakdown.findIndex((entry) => entry.date === date);
    const next = [...breakdown];
    if (existingIndex === -1) {
      next.push({
        date,
        total: 1,
        successful: isSuccessful ? 1 : 0,
        avgDurationSeconds: durationSeconds ?? 0,
      });
    } else {
      const entry = next[existingIndex];
      const total = entry.total + 1;
      const previousDurationSum = entry.avgDurationSeconds * entry.total;
      next[existingIndex] = {
        date,
        total,
        successful: entry.successful + (isSuccessful ? 1 : 0),
        avgDurationSeconds:
          durationSeconds !== null
            ? Math.round((previousDurationSum + durationSeconds) / total)
            : entry.avgDurationSeconds,
      };
    }
    return next.sort((a, b) => a.date.localeCompare(b.date)).slice(-DAILY_BREAKDOWN_DAYS);
  }

  private toRate(stats: PlatformOrEnvironmentStats): { count: number; rate: number } {
    return {
      count: stats.total,
      rate: stats.total > 0 ? Math.round((stats.successful / stats.total) * 1000) / 10 : 0,
    };
  }

  private emptyStats(
    userId: string,
    projectId: string,
    year: number,
    month: number,
  ): AnalyticsStats {
    return {
      userId,
      projectId,
      year,
      month,
      totalBuilds: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      totalCancelled: 0,
      byPlatform: {
        ios: { total: 0, successful: 0 },
        android: { total: 0, successful: 0 },
      },
      byEnvironment: {
        staging: { total: 0, successful: 0 },
        production: { total: 0, successful: 0 },
      },
      avgDurationSeconds: 0,
      successRate: 0,
    };
  }

  private emptyDocument(
    userId: string,
    projectId: string,
    year: number,
    month: number,
  ): BuildAnalyticsDocument {
    return {
      ...this.emptyStats(userId, projectId, year, month),
      dailyBreakdown: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }

  private getCurrentYearMonth(): { year: number; month: number } {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  private getCurrentDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private buildAnalyticsDocId(
    userId: string,
    projectId: string,
    year: number,
    month: number,
  ): string {
    return `${userId}#${projectId}#${year}#${month}`;
  }

  // Un FieldValue.serverTimestamp() non résolu (juste avant écriture) ne s'exporte pas en JSON :
  // uniquement les Timestamp effectivement lus depuis Firestore sont convertis en chaîne ISO.
  private toIsoString(value: Timestamp | FieldValue): string | null {
    return value instanceof Timestamp ? value.toDate().toISOString() : null;
  }
}
