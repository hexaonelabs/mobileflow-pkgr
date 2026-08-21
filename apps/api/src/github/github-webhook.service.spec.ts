import { createHmac } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GithubWebhookService,
  type PushWebhookPayload,
  type WorkflowRunWebhookPayload,
} from './github-webhook.service';
import { BuildStatus, TriggeredBy, Environment, type BuildDocument } from '../builds/build.model';
import type { BuildsService } from '../builds/builds.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { Platform } from '../projects/project.model';
import { Plan } from '../users/user.model';

const SECRET = 'test-secret';

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

function buildPayload(
  overrides: Partial<WorkflowRunWebhookPayload> = {},
): WorkflowRunWebhookPayload {
  return {
    action: 'completed',
    repository: { full_name: 'owner/repo' },
    workflow_run: {
      name: 'MobileFlow build build1 (ios, staging)',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/owner/repo/actions/runs/1',
      run_started_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:01:00.000Z',
    },
    ...overrides,
  };
}

describe('GithubWebhookService', () => {
  let config: ConfigService;
  let buildsService: { finalizeBuildStatus: jest.Mock; create: jest.Mock };
  let service: GithubWebhookService;

  beforeEach(() => {
    config = { getOrThrow: jest.fn().mockReturnValue(SECRET) } as unknown as ConfigService;
    buildsService = {
      finalizeBuildStatus: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue([]),
    };
  });

  describe('verifySignature', () => {
    beforeEach(() => {
      service = new GithubWebhookService(
        {} as FirestoreService,
        buildsService as unknown as BuildsService,
        config,
      );
    });

    it('accepts a valid HMAC signature', () => {
      const body = Buffer.from('payload');
      expect(() => service.verifySignature(body, sign('payload'))).not.toThrow();
    });

    it('rejects an invalid signature', () => {
      const body = Buffer.from('payload');
      expect(() => service.verifySignature(body, 'sha256=deadbeef')).toThrow(UnauthorizedException);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const body = Buffer.from('payload');
      const wrongSignature =
        'sha256=' + createHmac('sha256', 'wrong-secret').update('payload').digest('hex');
      expect(() => service.verifySignature(body, wrongSignature)).toThrow(UnauthorizedException);
    });
  });

  describe('handleWorkflowRunEvent', () => {
    const buildData: BuildDocument = {
      projectId: 'proj1',
      userId: 'user1',
      triggeredBy: TriggeredBy.manual,
      environment: Environment.staging,
      platform: Platform.ios,
      branch: 'main',
      commitSha: 'abc123',
      envVars: {},
      status: BuildStatus.running,
      githubRunId: 1,
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
      artifactUrl: null,
      logsUrl: null,
      artifactStoragePath: null,
      artifactUploadedAt: null,
      bundleId: null,
      bundleVersion: null,
      createdAt: null as never,
    };
    const buildRef = { id: 'ref-marker' };
    const buildDoc = { id: 'build1', data: () => buildData, ref: buildRef };

    function createFirestore(options: { projectFound?: boolean; matchingBuild?: boolean } = {}) {
      const { projectFound = true, matchingBuild = true } = options;
      const projectsQuery = {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest
          .fn()
          .mockResolvedValue(
            projectFound
              ? { empty: false, docs: [{ id: 'proj1', data: () => ({ userId: 'user1' }) }] }
              : { empty: true, docs: [] },
          ),
      };
      const buildsQuery = {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: matchingBuild ? [buildDoc] : [] }),
      };
      return {
        db: {
          collection: jest.fn((name: string) =>
            name === 'projects' ? projectsQuery : buildsQuery,
          ),
        },
      } as unknown as FirestoreService;
    }

    it('finalizes the matching build for a completed workflow_run', async () => {
      service = new GithubWebhookService(
        createFirestore(),
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handleWorkflowRunEvent(buildPayload());

      expect(buildsService.finalizeBuildStatus).toHaveBeenCalledWith(
        'user1',
        'proj1',
        'build1',
        buildRef,
        buildData,
        expect.objectContaining({ status: 'completed', conclusion: 'success' }),
      );
    });

    it('ignores actions other than "completed"', async () => {
      service = new GithubWebhookService(
        createFirestore(),
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handleWorkflowRunEvent(buildPayload({ action: 'requested' }));

      expect(buildsService.finalizeBuildStatus).not.toHaveBeenCalled();
    });

    it('no-ops when no project matches the repository', async () => {
      service = new GithubWebhookService(
        createFirestore({ projectFound: false }),
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handleWorkflowRunEvent(buildPayload());

      expect(buildsService.finalizeBuildStatus).not.toHaveBeenCalled();
    });

    it('no-ops when no pending build matches the run name', async () => {
      service = new GithubWebhookService(
        createFirestore({ matchingBuild: false }),
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handleWorkflowRunEvent(buildPayload());

      expect(buildsService.finalizeBuildStatus).not.toHaveBeenCalled();
    });
  });

  describe('handlePushEvent', () => {
    function pushPayload(overrides: Partial<PushWebhookPayload> = {}): PushWebhookPayload {
      return {
        ref: 'refs/heads/main',
        deleted: false,
        repository: { full_name: 'owner/repo' },
        ...overrides,
      };
    }

    interface StaleBuild {
      id: string;
      ref: { update: jest.Mock };
    }

    // Fake volontairement minimal (comme createFirestore() ci-dessus pour handleWorkflowRunEvent) :
    // where()/get() ignorent les critères de filtre réels et retournent directement les listes
    // passées en options — c'est le comportement de handlePushEvent lui-même qui est sous test,
    // pas la traduction des filtres Firestore (déjà couverte par les tests e2e FakeFirestoreDb).
    function createFirestoreForPush(
      options: {
        projects?: Array<{ id: string; data: Record<string, unknown> }>;
        staleBuilds?: StaleBuild[];
        users?: Record<string, { plan?: Plan }>;
      } = {},
    ) {
      const { projects = [], staleBuilds = [], users = {} } = options;

      const projectsQuery = {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: projects.length === 0,
          docs: projects.map((p) => ({ id: p.id, data: () => p.data })),
        }),
      };
      const buildsQuery = {
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: staleBuilds.length === 0,
          docs: staleBuilds.map((b) => ({ id: b.id, data: () => ({}), ref: b.ref })),
        }),
      };
      const usersCollection = {
        doc: jest.fn((userId: string) => ({
          get: jest.fn().mockResolvedValue({
            exists: userId in users,
            data: () => users[userId],
          }),
        })),
      };

      return {
        db: {
          collection: jest.fn((name: string) => {
            if (name === 'projects') return projectsQuery;
            if (name === 'builds') return buildsQuery;
            if (name === 'users') return usersCollection;
            throw new Error(`unexpected collection ${name}`);
          }),
        },
      } as unknown as FirestoreService;
    }

    function staleBuild(id: string): StaleBuild {
      return { id, ref: { update: jest.fn().mockResolvedValue(undefined) } };
    }

    it('ignores branch deletions without querying Firestore', async () => {
      const collectionSpy = jest.fn();
      const firestore = { db: { collection: collectionSpy } } as unknown as FirestoreService;
      service = new GithubWebhookService(
        firestore,
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handlePushEvent(pushPayload({ deleted: true }));

      expect(collectionSpy).not.toHaveBeenCalled();
      expect(buildsService.create).not.toHaveBeenCalled();
    });

    it('no-ops when no project matches the repo+autoTriggerBranch query', async () => {
      const firestore = createFirestoreForPush({ projects: [] });
      service = new GithubWebhookService(
        firestore,
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handlePushEvent(pushPayload());

      expect(buildsService.create).not.toHaveBeenCalled();
    });

    it('resolves the branch from "refs/heads/<branch>" and creates a staging build for both platforms', async () => {
      const firestore = createFirestoreForPush({
        projects: [{ id: 'proj1', data: { userId: 'user1', githubRepoFullName: 'owner/repo' } }],
        users: { user1: { plan: Plan.free } },
      });
      service = new GithubWebhookService(
        firestore,
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handlePushEvent(pushPayload({ ref: 'refs/heads/develop' }));

      expect(buildsService.create).toHaveBeenCalledWith('user1', 'proj1', Plan.free, {
        environment: Environment.staging,
        branch: 'develop',
        platforms: [Platform.android, Platform.ios],
      });
    });

    it('defaults the plan to free when the user document is missing', async () => {
      const firestore = createFirestoreForPush({
        projects: [
          { id: 'proj1', data: { userId: 'user-unknown', githubRepoFullName: 'owner/repo' } },
        ],
        users: {},
      });
      service = new GithubWebhookService(
        firestore,
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handlePushEvent(pushPayload());

      expect(buildsService.create).toHaveBeenCalledWith(
        'user-unknown',
        'proj1',
        Plan.free,
        expect.anything(),
      );
    });

    it('cancels stale queued/running builds for the same project+branch before creating the new one', async () => {
      const oldBuild = staleBuild('build-old');
      const firestore = createFirestoreForPush({
        projects: [{ id: 'proj1', data: { userId: 'user1', githubRepoFullName: 'owner/repo' } }],
        staleBuilds: [oldBuild],
        users: { user1: { plan: Plan.free } },
      });
      service = new GithubWebhookService(
        firestore,
        buildsService as unknown as BuildsService,
        config,
      );

      await service.handlePushEvent(pushPayload());

      expect(oldBuild.ref.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: BuildStatus.cancelled }),
      );
      const updateOrder = oldBuild.ref.update.mock.invocationCallOrder[0];
      const createOrder = buildsService.create.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(createOrder);
    });

    it("does not let one project's ForbiddenException block the others", async () => {
      const firestore = createFirestoreForPush({
        projects: [
          { id: 'proj1', data: { userId: 'user1', githubRepoFullName: 'owner/repo' } },
          { id: 'proj2', data: { userId: 'user2', githubRepoFullName: 'owner/repo' } },
        ],
        users: { user1: { plan: Plan.free }, user2: { plan: Plan.free } },
      });
      buildsService.create
        .mockRejectedValueOnce(new ForbiddenException('plan gratuit'))
        .mockResolvedValueOnce([]);
      service = new GithubWebhookService(
        firestore,
        buildsService as unknown as BuildsService,
        config,
      );

      await expect(service.handlePushEvent(pushPayload())).resolves.toBeUndefined();

      expect(buildsService.create).toHaveBeenCalledTimes(2);
    });
  });
});
