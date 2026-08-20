import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import {
  EMAIL_NOTIFICATION_JOB,
  NotificationsService,
  SLACK_NOTIFICATION_JOB,
} from './notifications.service';
import type { NotificationConfigService } from './notification-config.service';
import { NotificationEvent, type NotificationConfigResponse } from './notification-config.model';
import { BuildStatusChangedEvent } from '../builds/events/build-status-changed.event';
import { BuildStatus, Environment } from '../builds/build.model';
import { Platform } from '../projects/project.model';
import type { FirestoreService } from '../firestore/firestore.service';

const sendMail = jest.fn().mockResolvedValue(undefined);
const createTransport = jest.fn().mockReturnValue({ sendMail });

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransport(...args),
}));

function emptyConfig(
  overrides: Partial<NotificationConfigResponse> = {},
): NotificationConfigResponse {
  return {
    userId: 'user1',
    projectId: 'proj1',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function createConfigService(config: NotificationConfigResponse) {
  return { getConfig: jest.fn().mockResolvedValue(config) } as unknown as NotificationConfigService;
}

function createQueue() {
  return { add: jest.fn().mockResolvedValue(undefined) } as unknown as Queue;
}

function createSmtpConfigService(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'user',
    SMTP_PASSWORD: 'secret',
    SMTP_FROM: 'noreply@example.com',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) throw new Error(`missing ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;
}

function noSmtpConfigService(): ConfigService {
  return {
    get: jest.fn().mockReturnValue(undefined),
    getOrThrow: jest.fn(() => {
      throw new Error('missing config');
    }),
  } as unknown as ConfigService;
}

const buildEvent = new BuildStatusChangedEvent(
  'build1',
  'proj1',
  'user1',
  Platform.ios,
  Environment.staging,
  BuildStatus.success,
  125,
);

describe('NotificationsService', () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  describe('onBuildStatusChanged', () => {
    it('does nothing when the build status has no matching NotificationEvent (e.g. cancelled)', async () => {
      const queue = createQueue();
      const configService = createConfigService(
        emptyConfig({
          slack: {
            webhookUrl: 'https://hooks.slack.com/x',
            enabled: true,
            events: [NotificationEvent.buildFailed],
          },
        }),
      );
      const service = new NotificationsService(
        {} as FirestoreService,
        queue,
        configService,
        noSmtpConfigService(),
      );

      const cancelledEvent = new BuildStatusChangedEvent(
        'build1',
        'proj1',
        'user1',
        Platform.ios,
        Environment.staging,
        BuildStatus.cancelled,
        null,
      );
      await service.onBuildStatusChanged(cancelledEvent);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('queues a slack job when slack is enabled and subscribed to the event', async () => {
      const queue = createQueue();
      const configService = createConfigService(
        emptyConfig({
          slack: {
            webhookUrl: 'https://hooks.slack.com/x',
            enabled: true,
            events: [NotificationEvent.buildSuccess],
          },
        }),
      );
      const service = new NotificationsService(
        {} as FirestoreService,
        queue,
        configService,
        noSmtpConfigService(),
      );

      await service.onBuildStatusChanged(buildEvent);

      expect(queue.add).toHaveBeenCalledWith(
        SLACK_NOTIFICATION_JOB,
        expect.objectContaining({ event: buildEvent }),
        expect.objectContaining({ attempts: 3 }),
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('does not queue a slack job when slack is enabled but not subscribed to the event', async () => {
      const queue = createQueue();
      const configService = createConfigService(
        emptyConfig({
          slack: {
            webhookUrl: 'https://hooks.slack.com/x',
            enabled: true,
            events: [NotificationEvent.buildFailed],
          },
        }),
      );
      const service = new NotificationsService(
        {} as FirestoreService,
        queue,
        configService,
        noSmtpConfigService(),
      );

      await service.onBuildStatusChanged(buildEvent);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('queues an email job when email is enabled and subscribed to the event', async () => {
      const queue = createQueue();
      const configService = createConfigService(
        emptyConfig({ email: { enabled: true, events: [NotificationEvent.buildSuccess] } }),
      );
      const service = new NotificationsService(
        {} as FirestoreService,
        queue,
        configService,
        noSmtpConfigService(),
      );

      await service.onBuildStatusChanged(buildEvent);

      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_NOTIFICATION_JOB,
        { userId: 'user1', event: buildEvent },
        expect.objectContaining({ attempts: 3 }),
      );
    });

    it('queues both slack and email jobs when both are enabled and subscribed', async () => {
      const queue = createQueue();
      const configService = createConfigService(
        emptyConfig({
          slack: {
            webhookUrl: 'https://hooks.slack.com/x',
            enabled: true,
            events: [NotificationEvent.buildSuccess],
          },
          email: { enabled: true, events: [NotificationEvent.buildSuccess] },
        }),
      );
      const service = new NotificationsService(
        {} as FirestoreService,
        queue,
        configService,
        noSmtpConfigService(),
      );

      await service.onBuildStatusChanged(buildEvent);

      expect(queue.add).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendSlackNotification', () => {
    it('posts the formatted message to the webhook URL', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      (global as { fetch?: unknown }).fetch = fetchMock;
      const service = new NotificationsService(
        {} as FirestoreService,
        createQueue(),
        createConfigService(emptyConfig()),
        noSmtpConfigService(),
      );

      await service.sendSlackNotification(
        { webhookUrl: 'https://hooks.slack.com/x', enabled: true, events: [] },
        buildEvent,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/x');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.attachments[0].title).toBe('✅ Build success');
      expect(body.attachments[0].color).toBe('#36a64f');
      const fieldTitles = body.attachments[0].fields.map((f: { title: string }) => f.title);
      expect(fieldTitles).toEqual(['Platform', 'Environment', 'Build ID', 'Duration']);
      expect(
        body.attachments[0].fields.find((f: { title: string }) => f.title === 'Duration').value,
      ).toBe('2m 5s');
    });

    it('omits the Duration field when durationSeconds is null', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      (global as { fetch?: unknown }).fetch = fetchMock;
      const service = new NotificationsService(
        {} as FirestoreService,
        createQueue(),
        createConfigService(emptyConfig()),
        noSmtpConfigService(),
      );
      const eventWithoutDuration = new BuildStatusChangedEvent(
        'build1',
        'proj1',
        'user1',
        Platform.android,
        Environment.production,
        BuildStatus.failed,
        null,
      );

      await service.sendSlackNotification(
        { webhookUrl: 'https://hooks.slack.com/x', enabled: true, events: [] },
        eventWithoutDuration,
      );

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.attachments[0].color).toBe('#d9393d');
      expect(body.attachments[0].title).toBe('❌ Build failed');
      const fieldTitles = body.attachments[0].fields.map((f: { title: string }) => f.title);
      expect(fieldTitles).toEqual(['Platform', 'Environment', 'Build ID']);
    });

    it('throws when the webhook responds with a non-ok status', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      (global as { fetch?: unknown }).fetch = fetchMock;
      const service = new NotificationsService(
        {} as FirestoreService,
        createQueue(),
        createConfigService(emptyConfig()),
        noSmtpConfigService(),
      );

      await expect(
        service.sendSlackNotification(
          { webhookUrl: 'https://hooks.slack.com/x', enabled: true, events: [] },
          buildEvent,
        ),
      ).rejects.toThrow('500');
    });
  });

  describe('sendEmailNotification', () => {
    it('is a no-op when SMTP is not configured', async () => {
      const firestore = { db: { collection: jest.fn() } } as unknown as FirestoreService;
      const service = new NotificationsService(
        firestore,
        createQueue(),
        createConfigService(emptyConfig()),
        noSmtpConfigService(),
      );

      await service.sendEmailNotification('user1', buildEvent);

      expect(firestore.db.collection).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends an email to the user when SMTP is configured and the user has an email', async () => {
      const userDoc = { data: () => ({ email: 'dev@example.com' }) };
      const firestore = {
        db: {
          collection: jest.fn().mockReturnValue({
            doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue(userDoc) }),
          }),
        },
      } as unknown as FirestoreService;
      const service = new NotificationsService(
        firestore,
        createQueue(),
        createConfigService(emptyConfig()),
        createSmtpConfigService(),
      );

      await service.sendEmailNotification('user1', buildEvent);

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@example.com',
          to: 'dev@example.com',
          subject: expect.stringContaining('success'),
        }),
      );
    });

    it('does not send when the user has no email on file', async () => {
      const userDoc = { data: () => undefined };
      const firestore = {
        db: {
          collection: jest.fn().mockReturnValue({
            doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue(userDoc) }),
          }),
        },
      } as unknown as FirestoreService;
      const service = new NotificationsService(
        firestore,
        createQueue(),
        createConfigService(emptyConfig()),
        createSmtpConfigService(),
      );

      await service.sendEmailNotification('user1', buildEvent);

      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});
