import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { BuildStatus, Environment } from '../builds/build.model';
import { Platform, PROJECTS_COLLECTION } from '../projects/project.model';
import { Plan } from '../users/user.model';
import type { BuildAnalyticsDocument } from './build-analytics.model';
import type { FirestoreService } from '../firestore/firestore.service';
import type { QuotasService } from '../quotas/quotas.service';

// Free = mois courant uniquement, tous les autres plans = historique complet (all time).
function createFakeQuotas(): QuotasService {
  return {
    getAnalyticsHistoryMonths: (plan: Plan) => Promise.resolve(plan === Plan.free ? 1 : null),
  } as unknown as QuotasService;
}

interface FakeDocRef {
  id: string;
}

interface FakeTx {
  get: (
    ref: FakeDocRef,
  ) => Promise<{ exists: boolean; data: () => BuildAnalyticsDocument | undefined }>;
  set: (ref: FakeDocRef, value: BuildAnalyticsDocument) => void;
}

// Émule le comportement transactionnel de Firestore (lecture-modification-écriture avec retry
// automatique en cas de conflit) : suffisant pour prouver que recordBuild() ne perd aucune
// mise à jour lors d'appels concurrents, sans dépendre d'un émulateur Firestore réel.
function createAnalyticsFirestoreHarness(options: { projectFound?: boolean } = {}) {
  const { projectFound = true } = options;
  const store = new Map<string, { data: BuildAnalyticsDocument; version: number }>();

  const analyticsRoot = {
    doc: (
      id: string,
    ): FakeDocRef & {
      get: () => Promise<{ exists: boolean; data: () => BuildAnalyticsDocument | undefined }>;
    } => ({
      id,
      get: () => {
        const entry = store.get(id);
        return Promise.resolve({ exists: entry !== undefined, data: () => entry?.data });
      },
    }),
    // Émule les deux .where() equality chainés utilisés par fetchAllDocuments().
    where: (field: 'userId' | 'projectId', _op: '==', value: string) => ({
      where: (field2: 'userId' | 'projectId', _op2: '==', value2: string) => ({
        get: () => {
          const docs = [...store.values()]
            .filter((entry) => entry.data[field] === value && entry.data[field2] === value2)
            .map((entry) => ({ data: () => entry.data }));
          return Promise.resolve({ docs });
        },
      }),
    }),
  };

  const projectsRoot = {
    doc: jest.fn().mockReturnValue({
      get: jest
        .fn()
        .mockResolvedValue(
          projectFound
            ? { exists: true, data: () => ({ userId: 'user1' }) }
            : { exists: false, data: () => undefined },
        ),
    }),
  };

  const db = {
    collection: jest.fn((name: string) =>
      name === PROJECTS_COLLECTION ? projectsRoot : analyticsRoot,
    ),
    runTransaction: async (fn: (tx: FakeTx) => Promise<void>) => {
      for (;;) {
        const readVersions = new Map<string, number>();
        const writes = new Map<string, BuildAnalyticsDocument>();
        const tx: FakeTx = {
          get: (ref) => {
            const entry = store.get(ref.id);
            readVersions.set(ref.id, entry?.version ?? 0);
            return Promise.resolve({ exists: entry !== undefined, data: () => entry?.data });
          },
          set: (ref, value) => writes.set(ref.id, value),
        };
        await fn(tx);

        const hasConflict = [...readVersions].some(
          ([id, version]) => (store.get(id)?.version ?? 0) !== version,
        );
        if (hasConflict) {
          continue; // Simule le retry automatique d'une transaction Firestore en conflit.
        }
        for (const [id, value] of writes) {
          store.set(id, { data: value, version: (store.get(id)?.version ?? 0) + 1 });
        }
        return;
      }
    },
  };

  return { db: db as unknown as FirestoreService['db'], store };
}

function analyticsDocId(userId: string, projectId: string, year: number, month: number): string {
  return `${userId}#${projectId}#${year}#${month}`;
}

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

describe('AnalyticsService', () => {
  it('throws when the project is not owned by the user', async () => {
    const { db } = createAnalyticsFirestoreHarness({ projectFound: false });
    const service = new AnalyticsService({ db }, createFakeQuotas());

    await expect(service.getSummary('user1', 'proj1', Plan.free)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getSummary returns zeroed defaults when no build has been recorded yet', async () => {
    const { db } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db }, createFakeQuotas());

    const summary = await service.getSummary('user1', 'proj1', Plan.free);

    expect(summary.totalBuilds).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.byPlatform).toEqual({
      ios: { total: 0, successful: 0 },
      android: { total: 0, successful: 0 },
    });
  });

  it('recordBuild increments totals, per-platform/environment stats, and dailyBreakdown', async () => {
    const { db } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db }, createFakeQuotas());

    await service.recordBuild('user1', 'proj1', {
      platform: Platform.ios,
      environment: Environment.staging,
      status: BuildStatus.success,
      durationSeconds: 120,
    });

    const summary = await service.getSummary('user1', 'proj1', Plan.free);
    expect(summary.totalBuilds).toBe(1);
    expect(summary.totalSuccessful).toBe(1);
    expect(summary.byPlatform.ios).toEqual({ total: 1, successful: 1 });
    expect(summary.byEnvironment.staging).toEqual({ total: 1, successful: 1 });
    expect(summary.avgDurationSeconds).toBe(120);
    expect(summary.successRate).toBe(100);

    const breakdown = await service.getBreakdown('user1', 'proj1', Plan.free);
    expect(breakdown.platform.ios).toEqual({ count: 1, rate: 100 });
    expect(breakdown.environment.staging).toEqual({ count: 1, rate: 100 });
  });

  it('two concurrent recordBuild() calls the same day both land in dailyBreakdown (no lost update)', async () => {
    const { db, store } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db }, createFakeQuotas());

    await Promise.all([
      service.recordBuild('user1', 'proj1', {
        platform: Platform.ios,
        environment: Environment.staging,
        status: BuildStatus.success,
        durationSeconds: 60,
      }),
      service.recordBuild('user1', 'proj1', {
        platform: Platform.android,
        environment: Environment.production,
        status: BuildStatus.failed,
        durationSeconds: 30,
      }),
    ]);

    const summary = await service.getSummary('user1', 'proj1', Plan.free);
    expect(summary.totalBuilds).toBe(2);
    expect(summary.totalSuccessful).toBe(1);
    expect(summary.totalFailed).toBe(1);
    expect(summary.byPlatform.ios.total).toBe(1);
    expect(summary.byPlatform.android.total).toBe(1);

    const { year, month } = currentYearMonth();
    const rawDoc = store.get(analyticsDocId('user1', 'proj1', year, month))?.data;
    expect(rawDoc?.dailyBreakdown).toHaveLength(1);
    expect(rawDoc?.dailyBreakdown[0].total).toBe(2);
    expect(rawDoc?.dailyBreakdown[0].successful).toBe(1);
  });

  it('getTrends on the free plan only returns the current month', async () => {
    const { db } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db }, createFakeQuotas());

    await service.recordBuild('user1', 'proj1', {
      platform: Platform.ios,
      environment: Environment.staging,
      status: BuildStatus.success,
      durationSeconds: 60,
    });

    const trends = await service.getTrends('user1', 'proj1', Plan.free);
    expect(trends.months).toHaveLength(1);
    expect(trends.months[0]).toMatchObject(currentYearMonth());
    expect(trends.months[0].total).toBe(1);
    expect(trends.months[0].successRate).toBe(100);
  });

  it('getSummary/getTrends on a paid plan aggregate across all recorded months, not just the current one', async () => {
    const { db, store } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db }, createFakeQuotas());

    // Build enregistré "le mois dernier" : on écrit directement le document analytics
    // correspondant plutôt que de mocker Date, pour rester simple.
    const { year, month } = currentYearMonth();
    const lastMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    store.set(analyticsDocId('user1', 'proj1', lastMonth.year, lastMonth.month), {
      version: 1,
      data: {
        userId: 'user1',
        projectId: 'proj1',
        year: lastMonth.year,
        month: lastMonth.month,
        totalBuilds: 1,
        totalSuccessful: 1,
        totalFailed: 0,
        totalCancelled: 0,
        byPlatform: {
          ios: { total: 1, successful: 1 },
          android: { total: 0, successful: 0 },
        },
        byEnvironment: {
          staging: { total: 1, successful: 1 },
          production: { total: 0, successful: 0 },
        },
        dailyBreakdown: [],
        avgDurationSeconds: 90,
        successRate: 100,
        createdAt: undefined as never,
        updatedAt: undefined as never,
      },
    });

    const summary = await service.getSummary('user1', 'proj1', Plan.starter);
    expect(summary.totalBuilds).toBe(1);
    expect(summary.byPlatform.ios).toEqual({ total: 1, successful: 1 });

    const trends = await service.getTrends('user1', 'proj1', Plan.starter);
    expect(trends.months).toHaveLength(1);
    expect(trends.months[0]).toMatchObject({ year: lastMonth.year, month: lastMonth.month });

    // Sur le plan Free, ce même build du mois dernier reste invisible.
    const freeSummary = await service.getSummary('user1', 'proj1', Plan.free);
    expect(freeSummary.totalBuilds).toBe(0);
  });
});
