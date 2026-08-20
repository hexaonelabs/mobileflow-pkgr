import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { NotificationsController } from '../src/notifications/notifications.controller';
import { NotificationConfigService } from '../src/notifications/notification-config.service';
import {
  NotificationsService,
  NOTIFICATIONS_QUEUE,
} from '../src/notifications/notifications.service';
import { NotificationEvent } from '../src/notifications/notification-config.model';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PlanGuard } from '../src/auth/guards/plan.guard';
import { FirestoreService } from '../src/firestore/firestore.service';
import type { AuthenticatedUser } from '../src/auth/types/authenticated-user.type';
import { FakeFirestoreDb } from './support/fake-firestore';

function noSmtpConfigService(): ConfigService {
  return {
    get: jest.fn().mockReturnValue(undefined),
    getOrThrow: jest.fn(() => {
      throw new Error('missing config');
    }),
  } as unknown as ConfigService;
}

// Simule l'authentification JWT réelle (qui passe par un lookup Firestore, cf. JwtStrategy) :
// le plan de l'utilisateur pour la requête est piloté par l'en-tête `x-test-plan`, ce qui
// permet de tester PlanGuard (branché en aval, lui, sans mock) sur les deux endpoints
// POST /notifications/config et /notifications/test.
class FakeJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();
    req.user = {
      id: 'user1',
      email: 'dev@example.com',
      plan: req.headers['x-test-plan'] ?? 'free',
      githubInstallationId: null,
    };
    return true;
  }
}

// POST /projects/:id/notifications/config, /test — Task 7.2 : le CRUD de config Slack et
// l'envoi d'un message de test, avec le PlanGuard (Task 6.2) réellement exécuté en HTTP.
describe('Notifications config + test endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let db: FakeFirestoreDb;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    db = new FakeFirestoreDb();
    db.seed('projects', 'proj1', { userId: 'user1', githubRepoFullName: 'owner/repo' });
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        NotificationConfigService,
        NotificationsService,
        PlanGuard,
        Reflector,
        { provide: FirestoreService, useValue: { db } },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: queue },
        { provide: ConfigService, useValue: noSmtpConfigService() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET config is available to a free-plan user and returns the empty default', async () => {
    const response = await request(app.getHttpServer())
      .get('/projects/proj1/notifications/config')
      .set('x-test-plan', 'free');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ userId: 'user1', projectId: 'proj1' });
    expect(response.body).not.toHaveProperty('slack');
  });

  it('POST config is rejected for a free-plan user (PlanGuard, requires starter)', async () => {
    const response = await request(app.getHttpServer())
      .post('/projects/proj1/notifications/config')
      .set('x-test-plan', 'free')
      .send({
        slack: {
          webhookUrl: 'https://hooks.slack.com/services/x',
          enabled: true,
          events: [NotificationEvent.buildSuccess],
        },
      });

    expect(response.status).toBe(403);
    expect(db.getRaw('notificationConfigs', 'proj1')).toBeUndefined();
  });

  it('POST config succeeds for a starter-plan user and persists the slack config', async () => {
    const response = await request(app.getHttpServer())
      .post('/projects/proj1/notifications/config')
      .set('x-test-plan', 'starter')
      .send({
        slack: {
          webhookUrl: 'https://hooks.slack.com/services/x',
          enabled: true,
          events: [NotificationEvent.buildSuccess],
        },
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      slack: {
        webhookUrl: 'https://hooks.slack.com/services/x',
        enabled: true,
        events: [NotificationEvent.buildSuccess],
      },
    });
    expect(db.getRaw('notificationConfigs', 'proj1')).toMatchObject({
      slack: { webhookUrl: 'https://hooks.slack.com/services/x' },
    });
  });

  it('POST test is rejected for a free-plan user before Slack is even checked', async () => {
    const response = await request(app.getHttpServer())
      .post('/projects/proj1/notifications/test')
      .set('x-test-plan', 'free');

    expect(response.status).toBe(403);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('POST test returns 400 for a starter-plan user with no slack config saved', async () => {
    const response = await request(app.getHttpServer())
      .post('/projects/proj1/notifications/test')
      .set('x-test-plan', 'starter');

    expect(response.status).toBe(400);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('POST test queues a slack notification for a starter-plan user with slack enabled', async () => {
    db.seed('notificationConfigs', 'proj1', {
      userId: 'user1',
      projectId: 'proj1',
      slack: {
        webhookUrl: 'https://hooks.slack.com/services/x',
        enabled: true,
        events: [NotificationEvent.buildSuccess],
      },
      createdAt: null,
      updatedAt: null,
    });

    const response = await request(app.getHttpServer())
      .post('/projects/proj1/notifications/test')
      .set('x-test-plan', 'starter');

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: 'Notification de test envoyée.' });
    expect(queue.add).toHaveBeenCalledWith(
      'slack-notification',
      expect.anything(),
      expect.anything(),
    );
  });
});
