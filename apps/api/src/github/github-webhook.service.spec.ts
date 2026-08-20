import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GithubWebhookService, type WorkflowRunWebhookPayload } from './github-webhook.service';
import { BuildStatus, TriggeredBy, Environment, type BuildDocument } from '../builds/build.model';
import type { BuildsService } from '../builds/builds.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { Platform } from '../projects/project.model';

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
  let buildsService: { finalizeBuildStatus: jest.Mock };
  let service: GithubWebhookService;

  beforeEach(() => {
    config = { getOrThrow: jest.fn().mockReturnValue(SECRET) } as unknown as ConfigService;
    buildsService = { finalizeBuildStatus: jest.fn().mockResolvedValue(undefined) };
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
});
