import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { FirestoreService } from '../firestore/firestore.service';
import { PROJECTS_COLLECTION, Platform, type ProjectDocument } from '../projects/project.model';
import { BuildStatus, Environment } from '../builds/build.model';
import {
  ANALYTICS_COLLECTION,
  type AnalyticsBreakdownResponse,
  type AnalyticsSummaryResponse,
  type AnalyticsTrendsResponse,
  type BuildAnalyticsDocument,
} from './build-analytics.model';

const TRENDS_MONTHS = 3;
const DAILY_BREAKDOWN_DAYS = 30;

type DailyBreakdownEntry = BuildAnalyticsDocument['dailyBreakdown'][number];
type PlatformOrEnvironmentStats = { total: number; successful: number };
type AnalyticsStats = Omit<BuildAnalyticsDocument, 'createdAt' | 'updatedAt' | 'dailyBreakdown'>;

@Injectable()
export class AnalyticsService {
  constructor(private readonly firestore: FirestoreService) {}

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

  async getSummary(userId: string, projectId: string): Promise<AnalyticsSummaryResponse> {
    await this.getOwnedProject(userId, projectId);
    const { year, month } = this.getCurrentYearMonth();
    const doc = await this.fetchMonthDocument(userId, projectId, year, month);
    return {
      ...(doc ? this.toStats(doc) : this.emptyStats(userId, projectId, year, month)),
      createdAt: doc ? this.toIsoString(doc.createdAt) : null,
      updatedAt: doc ? this.toIsoString(doc.updatedAt) : null,
    };
  }

  async getTrends(userId: string, projectId: string): Promise<AnalyticsTrendsResponse> {
    await this.getOwnedProject(userId, projectId);
    const { year, month } = this.getCurrentYearMonth();
    const months = await Promise.all(
      this.lastNMonths(year, month, TRENDS_MONTHS).map(async ({ year: y, month: m }) => {
        const stats = await this.getMonthStats(userId, projectId, y, m);
        return {
          year: y,
          month: m,
          total: stats.totalBuilds,
          successful: stats.totalSuccessful,
          successRate: stats.successRate,
        };
      }),
    );
    return { months };
  }

  async getBreakdown(userId: string, projectId: string): Promise<AnalyticsBreakdownResponse> {
    await this.getOwnedProject(userId, projectId);
    const { year, month } = this.getCurrentYearMonth();
    const stats = await this.getMonthStats(userId, projectId, year, month);
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

  private lastNMonths(
    year: number,
    month: number,
    count: number,
  ): Array<{ year: number; month: number }> {
    return Array.from({ length: count }, (_, i) =>
      this.shiftYearMonth(year, month, -(count - 1 - i)),
    );
  }

  private shiftYearMonth(
    year: number,
    month: number,
    offset: number,
  ): { year: number; month: number } {
    const totalMonths = year * 12 + (month - 1) + offset;
    return { year: Math.floor(totalMonths / 12), month: (totalMonths % 12) + 1 };
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
