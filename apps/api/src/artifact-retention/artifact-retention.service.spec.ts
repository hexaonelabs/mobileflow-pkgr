import { Timestamp } from 'firebase-admin/firestore';
import { ArtifactRetentionService } from './artifact-retention.service';
import { BUILDS_COLLECTION, type BuildDocument } from '../builds/build.model';
import type { FirestoreService } from '../firestore/firestore.service';
import type { QuotasService } from '../quotas/quotas.service';
import type { StorageService } from '../storage/storage.service';
import { Plan, USERS_COLLECTION } from '../users/user.model';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const daysAgo = (days: number) => Timestamp.fromMillis(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('ArtifactRetentionService.isArtifactExpired', () => {
  let service: ArtifactRetentionService;

  beforeEach(() => {
    service = new ArtifactRetentionService(
      {} as FirestoreService,
      {} as StorageService,
      {} as QuotasService,
    );
  });

  it('never expires when retentionDays is null (unlimited plan)', () => {
    expect(service.isArtifactExpired(null, daysAgo(9999), NOW)).toBe(false);
  });

  it('never expires when the artifact has not been uploaded yet', () => {
    expect(service.isArtifactExpired(7, null, NOW)).toBe(false);
  });

  it('is not expired while still within the retention window', () => {
    expect(service.isArtifactExpired(7, daysAgo(6), NOW)).toBe(false);
  });

  it('is expired exactly at the retention boundary', () => {
    expect(service.isArtifactExpired(7, daysAgo(7), NOW)).toBe(true);
  });

  it('is expired past the retention window', () => {
    expect(service.isArtifactExpired(7, daysAgo(30), NOW)).toBe(true);
  });
});

interface FakeBuild {
  id: string;
  data: BuildDocument;
}

function buildDoc(overrides: Partial<BuildDocument> & { userId: string }): BuildDocument {
  return {
    projectId: 'proj1',
    triggeredBy: 'manual' as never,
    environment: 'staging' as never,
    platform: 'ios' as never,
    branch: 'main',
    commitSha: 'abc123',
    envVars: {},
    status: 'success' as never,
    githubRunId: 42,
    startedAt: null,
    finishedAt: null,
    durationSeconds: null,
    artifactUrl: null,
    logsUrl: null,
    artifactStoragePath: `builds/proj1/${overrides.userId}/app.ipa`,
    artifactUploadedAt: null,
    bundleId: null,
    bundleVersion: null,
    createdAt: null as never,
    ...overrides,
  };
}

function createFirestore(builds: FakeBuild[], usersByPlan: Record<string, Plan>) {
  const updates = new Map<string, Partial<BuildDocument>>();

  const buildsCollection = {
    where: jest.fn().mockReturnValue({
      get: () =>
        Promise.resolve({
          docs: builds
            .filter((build) => build.data.artifactStoragePath !== null)
            .map((build) => ({
              id: build.id,
              data: () => build.data,
              ref: {
                update: jest.fn((patch: Partial<BuildDocument>) => {
                  updates.set(build.id, patch);
                  return Promise.resolve();
                }),
              },
            })),
        }),
    }),
  };

  const usersCollection = {
    doc: (userId: string) => ({
      get: () =>
        Promise.resolve({
          data: () => ({ plan: usersByPlan[userId] }),
        }),
    }),
  };

  const db = {
    collection: jest.fn((name: string) => {
      if (name === BUILDS_COLLECTION) return buildsCollection;
      if (name === USERS_COLLECTION) return usersCollection;
      throw new Error(`unexpected collection ${name}`);
    }),
  };

  return { firestore: { db } as unknown as FirestoreService, updates };
}

describe('ArtifactRetentionService.purgeExpiredArtifacts', () => {
  it('deletes the storage file and clears the build only for expired artifacts', async () => {
    const builds: FakeBuild[] = [
      {
        id: 'expired-free',
        data: buildDoc({ userId: 'user-free', artifactUploadedAt: daysAgo(10) }),
      },
      {
        id: 'fresh-free',
        data: buildDoc({ userId: 'user-free', artifactUploadedAt: daysAgo(1) }),
      },
      {
        id: 'unlimited-enterprise',
        data: buildDoc({ userId: 'user-enterprise', artifactUploadedAt: daysAgo(9999) }),
      },
      {
        id: 'no-artifact',
        data: buildDoc({ userId: 'user-free', artifactStoragePath: null }),
      },
    ];
    const { firestore, updates } = createFirestore(builds, {
      'user-free': Plan.free,
      'user-enterprise': Plan.enterprise,
    });
    const deleteFile = jest.fn().mockResolvedValue(undefined);
    const storageService = { deleteFile } as unknown as StorageService;
    const getArtifactRetentionDays = jest.fn((plan: Plan) =>
      Promise.resolve(plan === Plan.free ? 7 : null),
    );
    const quotasService = { getArtifactRetentionDays } as unknown as QuotasService;

    const service = new ArtifactRetentionService(firestore, storageService, quotasService);
    jest.useFakeTimers({ now: NOW });

    const result = await service.purgeExpiredArtifacts();

    jest.useRealTimers();

    expect(result).toEqual({ purged: 1 });
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith('builds/proj1/user-free/app.ipa');
    expect(updates.get('expired-free')).toEqual({
      artifactStoragePath: null,
      artifactUploadedAt: null,
    });
    expect(updates.has('fresh-free')).toBe(false);
    expect(updates.has('unlimited-enterprise')).toBe(false);
  });
});
