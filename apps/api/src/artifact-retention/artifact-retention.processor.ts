import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ARTIFACT_RETENTION_QUEUE, ArtifactRetentionService } from './artifact-retention.service';

@Processor(ARTIFACT_RETENTION_QUEUE)
export class ArtifactRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(ArtifactRetentionProcessor.name);

  constructor(private readonly artifactRetentionService: ArtifactRetentionService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const { purged } = await this.artifactRetentionService.purgeExpiredArtifacts();
    this.logger.debug(`Sweep de rétention terminé : ${purged} artefact(s) purgé(s).`);
  }
}
