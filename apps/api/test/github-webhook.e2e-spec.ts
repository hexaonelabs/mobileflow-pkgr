import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { GithubWebhookController } from '../src/github/github-webhook.controller';
import { GithubWebhookService } from '../src/github/github-webhook.service';
import { BuildsService } from '../src/builds/builds.service';
import { GithubService } from '../src/github/github.service';
import { RunTokensService } from '../src/internal/run-tokens.service';
import { StorageService } from '../src/storage/storage.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import {
  NotificationsService,
  NOTIFICATIONS_QUEUE,
} from '../src/notifications/notifications.service';
import { NotificationConfigService } from '../src/notifications/notification-config.service';
import { NotificationEvent } from '../src/notifications/notification-config.model';
import { FirestoreService } from '../src/firestore/firestore.service';
import { BuildStatus, Environment, TriggeredBy } from '../src/builds/build.model';
import { Platform } from '../src/projects/project.model';
import { FakeFirestoreDb } from './support/fake-firestore';

const WEBHOOK_SECRET = 'test-webhook-secret';

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function fakeConfigService(): ConfigService {
  const values: Record<string, string> = { GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) throw new Error(`missing config ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;
}

// POST /github/webhook — Task 7.2 : prouve que le webhook GitHub, à lui seul (aucun appel
// client, aucun polling), fait remonter Analytics ET Notifications jusqu'au bout. C'est
// précisément le problème que la Phase 0 (webhook) résout — cf. l'avertissement en tête de
// PHASE_1_TASKS.md sur BuildsService.refreshStatus() qui ne se déclenchait auparavant que si
// quelqu'un avait l'app ouverte.
describe('POST /github/webhook (e2e)', () => {
  let app: INestApplication<App>;
  let db: FakeFirestoreDb;
  let queue: { add: jest.Mock<Promise<void>, [string, unknown, unknown]> };

  beforeEach(async () => {
    db = new FakeFirestoreDb();
    db.seed('projects', 'proj1', {
      userId: 'user1',
      githubRepoFullName: 'owner/repo',
    });
    db.seed('builds', 'build1', {
      projectId: 'proj1',
      userId: 'user1',
      triggeredBy: TriggeredBy.manual,
      environment: Environment.staging,
      platform: Platform.ios,
      branch: 'main',
      commitSha: 'abc123',
      envVars: {},
      status: BuildStatus.running,
      githubRunId: 42,
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
      artifactUrl: null,
      logsUrl: null,
      artifactStoragePath: null,
      bundleId: null,
      bundleVersion: null,
      createdAt: null,
    });
    db.seed('notificationConfigs', 'proj1', {
      userId: 'user1',
      projectId: 'proj1',
      slack: {
        webhookUrl: 'https://hooks.slack.com/services/x',
        enabled: true,
        events: [NotificationEvent.buildFailed],
      },
      createdAt: null,
      updatedAt: null,
    });

    queue = {
      add: jest.fn().mockResolvedValue(undefined) as jest.Mock<
        Promise<void>,
        [string, unknown, unknown]
      >,
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [GithubWebhookController],
      providers: [
        GithubWebhookService,
        BuildsService,
        AnalyticsService,
        NotificationsService,
        NotificationConfigService,
        { provide: FirestoreService, useValue: { db } },
        { provide: ConfigService, useValue: fakeConfigService() },
        { provide: GithubService, useValue: {} },
        { provide: RunTokensService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: queue },
      ],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('finalizes the build, records analytics, and queues the slack notification — with no client involved', async () => {
    const payload = {
      action: 'completed',
      repository: { full_name: 'owner/repo' },
      workflow_run: {
        name: 'MobileFlow build build1 (ios, staging)',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/owner/repo/actions/runs/1',
        run_started_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:01:00.000Z',
      },
    };
    const body = JSON.stringify(payload);

    const response = await request(app.getHttpServer())
      .post('/github/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'workflow_run')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });

    // Le build a été finalisé (status + finishedAt) directement par le webhook.
    const build = db.getRaw('builds', 'build1');
    expect(build?.status).toBe(BuildStatus.failed);
    expect(build?.finishedAt).toBeDefined();
    expect(build?.finishedAt).not.toBeNull();

    // Analytics a été incrémenté pour ce build, sans qu'aucun endpoint client n'ait été appelé.
    const now = new Date();
    const analyticsDocId = `user1#proj1#${now.getFullYear()}#${now.getMonth() + 1}`;
    const analyticsDoc = db.getRaw('analytics', analyticsDocId) as
      { totalBuilds: number; totalFailed: number } | undefined;
    expect(analyticsDoc?.totalBuilds).toBe(1);
    expect(analyticsDoc?.totalFailed).toBe(1);

    // La notification Slack a été mise en queue (le worker BullMQ, testé séparément dans
    // notifications.processor.spec.ts, l'enverrait ensuite).
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'slack-notification',
      expect.objectContaining({
        event: expect.objectContaining({ buildId: 'build1', status: BuildStatus.failed }) as object,
      }),
      expect.anything(),
    );
  });

  it('rejects a request with an invalid signature before touching Firestore', async () => {
    const body = JSON.stringify({ action: 'completed' });

    const response = await request(app.getHttpServer())
      .post('/github/webhook')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .set('x-github-event', 'workflow_run')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(401);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('ignores events other than workflow_run/push without finalizing anything', async () => {
    const body = JSON.stringify({ action: 'completed' });

    const response = await request(app.getHttpServer())
      .post('/github/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'issues')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ignored: true });
    expect(db.getRaw('builds', 'build1')?.status).toBe(BuildStatus.running);
  });

  // GithubService est mocké en `{}` dans ce module de test (comme pour le test workflow_run
  // ci-dessus) : cette assertion couvre le câblage webhook → handlePushEvent → réponse HTTP,
  // pas la création effective du build (déjà couverte finement, avec un GithubService/BuildsService
  // mockés au niveau attendu, par github-webhook.service.spec.ts).
  it('accepts a push event for a project with autoTriggerBranch set without crashing the request', async () => {
    db.seed('projects', 'proj2', {
      userId: 'user2',
      githubRepoFullName: 'owner/repo2',
      autoTriggerBranch: 'main',
    });
    db.seed('users', 'user2', { plan: 'free' });

    const payload = {
      ref: 'refs/heads/main',
      deleted: false,
      repository: { full_name: 'owner/repo2' },
    };
    const body = JSON.stringify(payload);

    const response = await request(app.getHttpServer())
      .post('/github/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'push')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });
  });

  it('ignores a push event when no project has auto-trigger enabled for that repo+branch', async () => {
    const payload = {
      ref: 'refs/heads/develop',
      deleted: false,
      repository: { full_name: 'owner/repo' },
    };
    const body = JSON.stringify(payload);

    const response = await request(app.getHttpServer())
      .post('/github/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'push')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });
  });
});
