import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobsOptions, Queue } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { BuildStatus } from '../builds/build.model';
import type { BuildStatusChangedEvent } from '../builds/events/build-status-changed.event';
import { FirestoreService } from '../firestore/firestore.service';
import { USERS_COLLECTION, type UserDocument } from '../users/user.model';
import {
  NotificationEvent,
  type EmailNotificationEvent,
  type NotificationConfigDocument,
} from './notification-config.model';
import { NotificationConfigService } from './notification-config.service';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const SLACK_NOTIFICATION_JOB = 'slack-notification';
export const EMAIL_NOTIFICATION_JOB = 'email-notification';

export interface SlackNotificationJobData {
  config: NonNullable<NotificationConfigDocument['slack']>;
  event: BuildStatusChangedEvent;
}

export interface EmailNotificationJobData {
  userId: string;
  event: BuildStatusChangedEvent;
}

const SLACK_WEBHOOK_TIMEOUT_MS = 5_000;
const RETRY_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly mailer: nodemailer.Transporter | null;

  constructor(
    private readonly firestore: FirestoreService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationQueue: Queue,
    private readonly notificationConfigService: NotificationConfigService,
    private readonly config: ConfigService,
  ) {
    this.mailer = this.createMailer();
  }

  async onBuildStatusChanged(event: BuildStatusChangedEvent): Promise<void> {
    const config = await this.notificationConfigService.getConfig(event.userId, event.projectId);
    const notificationEvent = this.toNotificationEvent(event.status);
    if (!notificationEvent) {
      return;
    }

    if (config.slack?.enabled && config.slack.events.includes(notificationEvent)) {
      await this.notificationQueue.add(
        SLACK_NOTIFICATION_JOB,
        { config: config.slack, event } satisfies SlackNotificationJobData,
        RETRY_JOB_OPTIONS,
      );
    }

    if (config.email?.enabled && config.email.events.includes(notificationEvent)) {
      await this.notificationQueue.add(
        EMAIL_NOTIFICATION_JOB,
        { userId: event.userId, event } satisfies EmailNotificationJobData,
        RETRY_JOB_OPTIONS,
      );
    }
  }

  // Appelé par NotificationsProcessor. BullMQ retente le job (RETRY_JOB_OPTIONS) si cette
  // méthode rejette.
  async sendSlackNotification(
    slackConfig: NonNullable<NotificationConfigDocument['slack']>,
    event: BuildStatusChangedEvent,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SLACK_WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(slackConfig.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.formatSlackMessage(event)),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Le webhook Slack a répondu avec le statut ${response.status}.`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // Appelé par NotificationsProcessor. BullMQ retente le job (RETRY_JOB_OPTIONS) si cette
  // méthode rejette.
  async sendEmailNotification(userId: string, event: BuildStatusChangedEvent): Promise<void> {
    if (!this.mailer) {
      this.logger.warn('SMTP non configuré : notification email ignorée.');
      return;
    }

    const doc = await this.firestore.db.collection(USERS_COLLECTION).doc(userId).get();
    const email = (doc.data() as UserDocument | undefined)?.email;
    if (!email) {
      this.logger.warn(`Utilisateur ${userId} introuvable ou sans email, notification ignorée.`);
      return;
    }

    await this.mailer.sendMail({
      from: this.config.getOrThrow<string>('SMTP_FROM'),
      to: email,
      subject: `Build ${event.status} — ${event.platform}`,
      text: this.formatEmailBody(event),
    });
  }

  // Hébergement décidé (PHASE_2_TASKS.md Step 0) : VPS Infomaniak existant, pas de Firebase
  // Function — conserve la résidence des données en EU et évite une dépendance croisée
  // supplémentaire. En local, personne n'a forcément ces variables — on dégrade en no-op
  // plutôt que d'empêcher l'API de démarrer.
  private createMailer(): nodemailer.Transporter | null {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');
    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP non configuré (SMTP_HOST/SMTP_USER/SMTP_PASSWORD manquants) : les notifications par email seront désactivées.',
      );
      return null;
    }

    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  // Seuls success/failed sont notifiables : NotificationEvent ne modélise pas de statut
  // "cancelled" ni "running" (build.started n'est jamais atteint depuis ce point d'entrée,
  // qui n'est appelé que sur build terminé — cf. BuildsService.finalizeBuildStatus).
  private toNotificationEvent(status: BuildStatus): EmailNotificationEvent | null {
    switch (status) {
      case BuildStatus.success:
        return NotificationEvent.buildSuccess;
      case BuildStatus.failed:
        return NotificationEvent.buildFailed;
      default:
        return null;
    }
  }

  private formatEmailBody(event: BuildStatusChangedEvent): string {
    return `Le build ${event.buildId} (${event.platform}, ${event.environment}) est maintenant "${event.status}".`;
  }

  private formatSlackMessage(event: BuildStatusChangedEvent): Record<string, unknown> {
    const isSuccess = event.status === BuildStatus.success;
    const color = isSuccess ? '#36a64f' : '#d9393d';
    const emoji = isSuccess ? '✅' : '❌';

    return {
      attachments: [
        {
          color,
          title: `${emoji} Build ${event.status}`,
          fields: [
            { title: 'Platform', value: event.platform, short: true },
            { title: 'Environment', value: event.environment, short: true },
            { title: 'Build ID', value: event.buildId, short: true },
            ...(event.durationSeconds !== null
              ? [
                  {
                    title: 'Duration',
                    value: `${Math.floor(event.durationSeconds / 60)}m ${event.durationSeconds % 60}s`,
                    short: true,
                  },
                ]
              : []),
          ],
        },
      ],
    };
  }
}
