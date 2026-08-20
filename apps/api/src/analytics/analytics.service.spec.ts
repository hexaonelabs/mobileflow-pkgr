import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { BuildStatus, Environment } from '../builds/build.model';
import { Platform, PROJECTS_COLLECTION } from '../projects/project.model';
import type { BuildAnalyticsDocument } from './build-analytics.model';
import type { FirestoreService } from '../firestore/firestore.service';

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
    const service = new AnalyticsService({ db });

    await expect(service.getSummary('user1', 'proj1')).rejects.toThrow(NotFoundException);
  });

  it('getSummary returns zeroed defaults when no build has been recorded yet', async () => {
    const { db } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db });

    const summary = await service.getSummary('user1', 'proj1');

    expect(summary.totalBuilds).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.byPlatform).toEqual({
      ios: { total: 0, successful: 0 },
      android: { total: 0, successful: 0 },
    });
  });

  it('recordBuild increments totals, per-platform/environment stats, and dailyBreakdown', async () => {
    const { db } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db });

    await service.recordBuild('user1', 'proj1', {
      platform: Platform.ios,
      environment: Environment.staging,
      status: BuildStatus.success,
      durationSeconds: 120,
    });

    const summary = await service.getSummary('user1', 'proj1');
    expect(summary.totalBuilds).toBe(1);
    expect(summary.totalSuccessful).toBe(1);
    expect(summary.byPlatform.ios).toEqual({ total: 1, successful: 1 });
    expect(summary.byEnvironment.staging).toEqual({ total: 1, successful: 1 });
    expect(summary.avgDurationSeconds).toBe(120);
    expect(summary.successRate).toBe(100);

    const breakdown = await service.getBreakdown('user1', 'proj1');
    expect(breakdown.platform.ios).toEqual({ count: 1, rate: 100 });
    expect(breakdown.environment.staging).toEqual({ count: 1, rate: 100 });
  });

  it('two concurrent recordBuild() calls the same day both land in dailyBreakdown (no lost update)', async () => {
    const { db, store } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db });

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

    const summary = await service.getSummary('user1', 'proj1');
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

  it('getTrends returns the last 3 months, oldest first, zeroed when no data exists', async () => {
    const { db } = createAnalyticsFirestoreHarness();
    const service = new AnalyticsService({ db });

    await service.recordBuild('user1', 'proj1', {
      platform: Platform.ios,
      environment: Environment.staging,
      status: BuildStatus.success,
      durationSeconds: 60,
    });

    const trends = await service.getTrends('user1', 'proj1');
    expect(trends.months).toHaveLength(3);
    expect(trends.months[2].total).toBe(1);
    expect(trends.months[2].successRate).toBe(100);
    expect(trends.months[0].total).toBe(0);
  });
});
