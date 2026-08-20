import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ProjectsController } from '../src/projects/projects.controller';
import { ProjectsService } from '../src/projects/projects.service';
import { SecretsService } from '../src/secrets/secrets.service';
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
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { FirestoreService } from '../src/firestore/firestore.service';
import type { AuthenticatedUser } from '../src/auth/types/authenticated-user.type';
import { BuildStatus, Environment, TriggeredBy } from '../src/builds/build.model';
import { Platform } from '../src/projects/project.model';
import { FakeFirestoreDb } from './support/fake-firestore';

class FakeJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    req.user = { id: 'user1', email: 'dev@example.com', plan: 'free', githubInstallationId: null };
    return true;
  }
}

function noSmtpConfigService(): ConfigService {
  return {
    get: jest.fn().mockReturnValue(undefined),
    getOrThrow: jest.fn(() => {
      throw new Error('missing config');
    }),
  } as unknown as ConfigService;
}

// POST /projects/:id/builds/:buildId/refresh — Task 7.2 : le chemin de polling client
// (existant avant la Phase 0) déclenche toujours, lui aussi, finalizeBuildStatus() et donc
// Analytics — non-régression par rapport au webhook testé dans github-webhook.e2e-spec.ts.
describe('POST /projects/:id/builds/:buildId/refresh (e2e)', () => {
  let app: INestApplication<App>;
  let db: FakeFirestoreDb;
  let getWorkflowRun: jest.Mock;

  beforeEach(async () => {
    db = new FakeFirestoreDb();
    db.seed('projects', 'proj1', { userId: 'user1', githubRepoFullName: 'owner/repo' });
    db.seed('builds', 'build1', {
      projectId: 'proj1',
      userId: 'user1',
      triggeredBy: TriggeredBy.manual,
      environment: Environment.production,
      platform: Platform.android,
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

    getWorkflowRun = jest.fn().mockResolvedValue({
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/owner/repo/actions/runs/1',
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:02:00.000Z',
    });
    const findArtifactUrl = jest.fn().mockResolvedValue('https://storage.example.com/build1.apk');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        BuildsService,
        AnalyticsService,
        NotificationsService,
        NotificationConfigService,
        { provide: ProjectsService, useValue: {} },
        { provide: SecretsService, useValue: {} },
        { provide: FirestoreService, useValue: { db } },
        { provide: GithubService, useValue: { getWorkflowRun, findArtifactUrl } },
        { provide: RunTokensService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: noSmtpConfigService() },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: { add: jest.fn() } },
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

  it('finalizes the build via polling and increments analytics, without any webhook involved', async () => {
    const response = await request(app.getHttpServer()).post(
      '/projects/proj1/builds/build1/refresh',
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: BuildStatus.success });

    const build = db.getRaw('builds', 'build1');
    expect(build?.status).toBe(BuildStatus.success);
    expect(build?.finishedAt).toBeDefined();

    const now = new Date();
    const analyticsDocId = `user1#proj1#${now.getFullYear()}#${now.getMonth() + 1}`;
    const analyticsDoc = db.getRaw('analytics', analyticsDocId) as
      | {
          totalBuilds: number;
          totalSuccessful: number;
          byPlatform: Record<string, { total: number }>;
        }
      | undefined;
    expect(analyticsDoc?.totalBuilds).toBe(1);
    expect(analyticsDoc?.totalSuccessful).toBe(1);
    expect(analyticsDoc?.byPlatform.android.total).toBe(1);
  });

  it('is idempotent: refreshing an already-finished build does not double-count analytics', async () => {
    await request(app.getHttpServer()).post('/projects/proj1/builds/build1/refresh');
    await request(app.getHttpServer()).post('/projects/proj1/builds/build1/refresh');

    const now = new Date();
    const analyticsDocId = `user1#proj1#${now.getFullYear()}#${now.getMonth() + 1}`;
    const analyticsDoc = db.getRaw('analytics', analyticsDocId) as
      { totalBuilds: number } | undefined;
    expect(analyticsDoc?.totalBuilds).toBe(1);
    expect(getWorkflowRun).toHaveBeenCalledTimes(2);
  });
});
