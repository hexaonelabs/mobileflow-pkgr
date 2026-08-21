import { Plan } from '../users/user.model';
import type { FirestoreService } from '../firestore/firestore.service';
import { PLAN_QUOTAS_DOC_ID, type PlanQuotasDocument } from './plan-quotas.model';
import { QuotasService } from './quotas.service';

function createFirestore(seed?: PlanQuotasDocument) {
  const store = new Map<string, PlanQuotasDocument>();
  if (seed) store.set(PLAN_QUOTAS_DOC_ID, seed);

  const root = {
    doc: (id: string) => ({
      get: () => Promise.resolve({ exists: store.has(id), data: () => store.get(id) }),
      set: (value: PlanQuotasDocument) => {
        store.set(id, value);
        return Promise.resolve();
      },
    }),
  };

  const db = { collection: jest.fn(() => root) };
  return { db: db as unknown as FirestoreService['db'], store };
}

describe('QuotasService', () => {
  it('auto-seeds the default quotas document when it does not exist yet', async () => {
    const { db, store } = createFirestore();
    const service = new QuotasService({ db });

    const limit = await service.getProjectsLimit(Plan.free);

    expect(limit).toBe(1);
    expect(store.get(PLAN_QUOTAS_DOC_ID)?.free.projectsLimit).toBe(1);
    expect(store.get(PLAN_QUOTAS_DOC_ID)?.starter.projectsLimit).toBe(5);
  });

  it('reads the existing document instead of overwriting it', async () => {
    const { db, store } = createFirestore({
      free: { projectsLimit: 2, artifactRetentionDays: 7 },
      starter: { projectsLimit: 10, artifactRetentionDays: 30 },
      pro: { projectsLimit: null, artifactRetentionDays: 90 },
      enterprise: { projectsLimit: null, artifactRetentionDays: null },
    });
    const service = new QuotasService({ db });

    const limit = await service.getProjectsLimit(Plan.starter);

    expect(limit).toBe(10);
    expect(store.get(PLAN_QUOTAS_DOC_ID)?.free.projectsLimit).toBe(2);
  });

  it('treats null as unlimited', async () => {
    const { db } = createFirestore({
      free: { projectsLimit: 1, artifactRetentionDays: 7 },
      starter: { projectsLimit: 5, artifactRetentionDays: 30 },
      pro: { projectsLimit: null, artifactRetentionDays: 90 },
      enterprise: { projectsLimit: null, artifactRetentionDays: null },
    });
    const service = new QuotasService({ db });

    await expect(service.getProjectsLimit(Plan.pro)).resolves.toBeNull();
  });

  it('auto-seeds and returns the default artifact retention days', async () => {
    const { db, store } = createFirestore();
    const service = new QuotasService({ db });

    await expect(service.getArtifactRetentionDays(Plan.free)).resolves.toBe(7);
    await expect(service.getArtifactRetentionDays(Plan.starter)).resolves.toBe(30);
    await expect(service.getArtifactRetentionDays(Plan.pro)).resolves.toBe(90);
    await expect(service.getArtifactRetentionDays(Plan.enterprise)).resolves.toBeNull();
    expect(store.get(PLAN_QUOTAS_DOC_ID)?.free.artifactRetentionDays).toBe(7);
  });

  it('reads the existing artifact retention days instead of the default', async () => {
    const { db } = createFirestore({
      free: { projectsLimit: 1, artifactRetentionDays: 3 },
      starter: { projectsLimit: 5, artifactRetentionDays: 30 },
      pro: { projectsLimit: null, artifactRetentionDays: 90 },
      enterprise: { projectsLimit: null, artifactRetentionDays: null },
    });
    const service = new QuotasService({ db });

    await expect(service.getArtifactRetentionDays(Plan.free)).resolves.toBe(3);
  });
});
