import { Injectable, Logger } from '@nestjs/common';
import { Timestamp } from 'firebase-admin/firestore';
import { BUILDS_COLLECTION, type BuildDocument } from '../builds/build.model';
import { FirestoreService } from '../firestore/firestore.service';
import { QuotasService } from '../quotas/quotas.service';
import { StorageService } from '../storage/storage.service';
import { Plan, USERS_COLLECTION, type UserDocument } from '../users/user.model';

export const ARTIFACT_RETENTION_QUEUE = 'artifact-retention';
export const PURGE_EXPIRED_ARTIFACTS_JOB = 'purge-expired-artifacts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class ArtifactRetentionService {
  private readonly logger = new Logger(ArtifactRetentionService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly storageService: StorageService,
    private readonly quotasService: QuotasService,
  ) {}

  // Pure — testable sans Firestore/Storage. `retentionDays: null` = illimité, jamais expiré.
  isArtifactExpired(
    retentionDays: number | null,
    artifactUploadedAt: Timestamp | null,
    now: Date,
  ): boolean {
    if (retentionDays === null || artifactUploadedAt === null) {
      return false;
    }
    const cutoffMs = now.getTime() - retentionDays * MS_PER_DAY;
    return artifactUploadedAt.toMillis() <= cutoffMs;
  }

  // Sweep périodique (cf. ArtifactRetentionModule pour la planification BullMQ). Le plan est
  // relu en direct pour chaque propriétaire — même philosophie que ProjectsService.getQuotaUsage
  // — pas figé au moment de l'upload, donc un downgrade raccourcit la rétention immédiatement.
  async purgeExpiredArtifacts(): Promise<{ purged: number }> {
    const snapshot = await this.firestore.db
      .collection(BUILDS_COLLECTION)
      .where('artifactStoragePath', '!=', null)
      .get();

    const now = new Date();
    const retentionDaysByPlan = new Map<Plan, number | null>();
    let purged = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data() as BuildDocument;
      if (!data.artifactStoragePath || !data.userId) {
        continue;
      }

      const plan = await this.getUserPlan(data.userId);
      let retentionDays = retentionDaysByPlan.get(plan);
      if (retentionDays === undefined) {
        retentionDays = await this.quotasService.getArtifactRetentionDays(plan);
        retentionDaysByPlan.set(plan, retentionDays);
      }

      const artifactUploadedAt =
        data.artifactUploadedAt instanceof Timestamp ? data.artifactUploadedAt : null;
      if (!this.isArtifactExpired(retentionDays, artifactUploadedAt, now)) {
        continue;
      }

      await this.storageService.deleteFile(data.artifactStoragePath);
      await doc.ref.update({ artifactStoragePath: null, artifactUploadedAt: null });
      purged += 1;
    }

    if (purged > 0) {
      this.logger.log(`${purged} artefact(s) staging expiré(s) purgé(s).`);
    }
    return { purged };
  }

  private async getUserPlan(userId: string): Promise<Plan> {
    const doc = await this.firestore.db.collection(USERS_COLLECTION).doc(userId).get();
    return (doc.data() as UserDocument | undefined)?.plan ?? Plan.free;
  }
}
