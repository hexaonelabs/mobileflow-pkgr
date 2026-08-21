import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Module, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QuotasModule } from '../quotas/quotas.module';
import { StorageModule } from '../storage/storage.module';
import { ArtifactRetentionProcessor } from './artifact-retention.processor';
import {
  ARTIFACT_RETENTION_QUEUE,
  ArtifactRetentionService,
  PURGE_EXPIRED_ARTIFACTS_JOB,
} from './artifact-retention.service';

const PURGE_SCHEDULER_ID = 'purge-expired-artifacts-daily';
const DAILY_AT_3AM_CRON = '0 3 * * *';

@Module({
  imports: [
    BullModule.registerQueue({ name: ARTIFACT_RETENTION_QUEUE }),
    QuotasModule,
    StorageModule,
  ],
  providers: [ArtifactRetentionService, ArtifactRetentionProcessor],
  exports: [ArtifactRetentionService],
})
export class ArtifactRetentionModule implements OnModuleInit {
  constructor(
    @InjectQueue(ARTIFACT_RETENTION_QUEUE) private readonly queue: Queue,
  ) {}

  // upsertJobScheduler est déduplié par jobSchedulerId côté Redis : si l'API tourne sur
  // plusieurs instances, chacune l'appelle au démarrage sans créer de planification en double
  // (contrairement à un @Cron() par instance, qui dupliquerait les suppressions).
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      PURGE_SCHEDULER_ID,
      { pattern: DAILY_AT_3AM_CRON },
      { name: PURGE_EXPIRED_ARTIFACTS_JOB },
    );
  }
}
