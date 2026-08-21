import { Test, TestingModule } from '@nestjs/testing';
import { Timestamp } from 'firebase-admin/firestore';
import { ArtifactRetentionService } from '../src/artifact-retention/artifact-retention.service';
import { BUILDS_COLLECTION } from '../src/builds/build.model';
import { FirestoreService } from '../src/firestore/firestore.service';
import { QuotasService } from '../src/quotas/quotas.service';
import { StorageService } from '../src/storage/storage.service';
import { Plan, USERS_COLLECTION } from '../src/users/user.model';
import { FakeFirestoreDb } from './support/fake-firestore';

// PHASE 2 — sweep de rétention des artefacts staging : vérifie de bout en bout (vrai QuotasService,
// vraie Firestore-like DB) que seul le build expiré est purgé, sans toucher au build encore
// dans sa fenêtre de rétention ni aux builds d'un plan illimité.
describe('ArtifactRetentionService.purgeExpiredArtifacts (e2e)', () => {
  let db: FakeFirestoreDb;
  let deleteFile: jest.Mock;
  let service: ArtifactRetentionService;

  const daysAgo = (days: number) => Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    db = new FakeFirestoreDb();
    db.seed(USERS_COLLECTION, 'user-free', { plan: Plan.free });
    db.seed(USERS_COLLECTION, 'user-pro', { plan: Plan.pro });

    db.seed(BUILDS_COLLECTION, 'build-expired', {
      projectId: 'proj1',
      userId: 'user-free',
      status: 'success',
      artifactStoragePath: 'builds/proj1/build-expired/app.ipa',
      artifactUploadedAt: daysAgo(10), // free plan retention = 7 jours par défaut
    });
    db.seed(BUILDS_COLLECTION, 'build-fresh', {
      projectId: 'proj1',
      userId: 'user-free',
      status: 'success',
      artifactStoragePath: 'builds/proj1/build-fresh/app.ipa',
      artifactUploadedAt: daysAgo(2),
    });
    db.seed(BUILDS_COLLECTION, 'build-pro-old-but-within-window', {
      projectId: 'proj1',
      userId: 'user-pro',
      status: 'success',
      artifactStoragePath: 'builds/proj1/build-pro-old-but-within-window/app.ipa',
      artifactUploadedAt: daysAgo(45), // pro plan retention = 90 jours par défaut
    });
    db.seed(BUILDS_COLLECTION, 'build-not-hosted', {
      projectId: 'proj1',
      userId: 'user-free',
      status: 'success',
      artifactStoragePath: null,
      artifactUploadedAt: null,
    });

    deleteFile = jest.fn().mockResolvedValue(undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        ArtifactRetentionService,
        QuotasService,
        { provide: FirestoreService, useValue: { db } },
        { provide: StorageService, useValue: { deleteFile } },
      ],
    }).compile();

    service = moduleFixture.get(ArtifactRetentionService);
  });

  it('deletes the storage file and clears retention fields only for the expired build', async () => {
    const result = await service.purgeExpiredArtifacts();

    expect(result).toEqual({ purged: 1 });
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith('builds/proj1/build-expired/app.ipa');

    expect(db.getRaw(BUILDS_COLLECTION, 'build-expired')).toMatchObject({
      artifactStoragePath: null,
      artifactUploadedAt: null,
    });
    expect(db.getRaw(BUILDS_COLLECTION, 'build-fresh')).toMatchObject({
      artifactStoragePath: 'builds/proj1/build-fresh/app.ipa',
    });
    expect(db.getRaw(BUILDS_COLLECTION, 'build-pro-old-but-within-window')).toMatchObject({
      artifactStoragePath: 'builds/proj1/build-pro-old-but-within-window/app.ipa',
    });
  });
});
