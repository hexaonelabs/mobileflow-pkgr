import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  EMAIL_NOTIFICATION_JOB,
  NOTIFICATIONS_QUEUE,
  NotificationsService,
  SLACK_NOTIFICATION_JOB,
  type EmailNotificationJobData,
  type SlackNotificationJobData,
} from './notifications.service';

// @nestjs/bullmq (v11) remplace l'ancien décorateur @Process() de @nestjs/bull par une classe
// unique par queue héritant de WorkerHost — un seul job (peu importe son nom) est traité à la
// fois par process(), d'où le dispatch manuel sur job.name.
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SLACK_NOTIFICATION_JOB: {
        const { config, event } = job.data as SlackNotificationJobData;
        return this.notificationsService.sendSlackNotification(config, event);
      }
      case EMAIL_NOTIFICATION_JOB: {
        const { userId, event } = job.data as EmailNotificationJobData;
        return this.notificationsService.sendEmailNotification(userId, event);
      }
      default:
        this.logger.warn(`Job de type inconnu ignoré : ${job.name}`);
    }
  }
}
