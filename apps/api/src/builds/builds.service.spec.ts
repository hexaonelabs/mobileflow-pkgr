import { BuildsService } from './builds.service';
import { BuildStatus, Environment, TriggeredBy, type BuildDocument } from './build.model';
import { Platform } from '../projects/project.model';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { FirestoreService } from '../firestore/firestore.service';
import type { GithubService } from '../github/github.service';

function buildDocument(overrides: Partial<BuildDocument> = {}): BuildDocument {
  return {
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
    createdAt: null as never,
    ...overrides,
  };
}

function createRef(finalData: BuildDocument) {
  return {
    update: jest.fn<Promise<void>, [Partial<BuildDocument>]>().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue({ data: () => finalData }),
  };
}

describe('BuildsService.finalizeBuildStatus', () => {
  let githubService: { findArtifactUrl: jest.Mock };
  let analyticsService: { recordBuild: jest.Mock };
  let service: BuildsService;

  beforeEach(() => {
    githubService = {
      findArtifactUrl: jest.fn().mockResolvedValue('https://github.com/owner/repo/artifact'),
    };
    analyticsService = { recordBuild: jest.fn().mockResolvedValue(undefined) };
    const firestore = {
      db: {
        collection: jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({ userId: 'user1', githubRepoFullName: 'owner/repo' }),
            }),
          }),
        }),
      },
    } as unknown as FirestoreService;

    service = new BuildsService(
      firestore,
      githubService as unknown as GithubService,
      undefined as never,
      undefined as never,
      undefined as never,
      analyticsService as unknown as AnalyticsService,
    );
  });

  it('finalizes a successful run: sets finishedAt/duration and resolves the artifact URL', async () => {
    const data = buildDocument();
    const ref = createRef(buildDocument({ status: BuildStatus.success }));

    const result = await service.finalizeBuildStatus(
      'user1',
      'proj1',
      'build1',
      ref as never,
      data,
      {
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'https://github.com/owner/repo/actions/runs/1',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
      },
    );

    expect(result.isFinished).toBe(true);
    expect(ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: BuildStatus.success, durationSeconds: 60 }),
    );
    expect(githubService.findArtifactUrl).toHaveBeenCalledWith(
      'user1',
      'owner/repo',
      data.githubRunId,
      'mobileflow-build1-ios',
    );
    expect(analyticsService.recordBuild).toHaveBeenCalledWith('user1', 'proj1', {
      platform: Platform.ios,
      environment: Environment.staging,
      status: BuildStatus.success,
      durationSeconds: 60,
    });
  });

  it('is idempotent: does not touch finishedAt/duration/artifactUrl when the build is already finished', async () => {
    const data = buildDocument({
      status: BuildStatus.success,
      finishedAt: 'already-set' as never,
      artifactUrl: 'already-set',
    });
    const ref = createRef(data);

    const result = await service.finalizeBuildStatus(
      'user1',
      'proj1',
      'build1',
      ref as never,
      data,
      {
        status: 'completed',
        conclusion: 'success',
        htmlUrl: 'https://github.com/owner/repo/actions/runs/1',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:05:00.000Z',
      },
    );

    expect(result.isFinished).toBe(false);
    const update = ref.update.mock.calls[0][0];
    expect(update.finishedAt).toBeUndefined();
    expect(update.durationSeconds).toBeUndefined();
    expect(update.artifactUrl).toBeUndefined();
    expect(githubService.findArtifactUrl).not.toHaveBeenCalled();
    expect(analyticsService.recordBuild).not.toHaveBeenCalled();
  });

  it('maps a failed conclusion to BuildStatus.failed without touching artifactUrl', async () => {
    const data = buildDocument();
    const ref = createRef(buildDocument({ status: BuildStatus.failed }));

    const result = await service.finalizeBuildStatus(
      'user1',
      'proj1',
      'build1',
      ref as never,
      data,
      {
        status: 'completed',
        conclusion: 'failure',
        htmlUrl: 'https://github.com/owner/repo/actions/runs/1',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:02:00.000Z',
      },
    );

    expect(result.isFinished).toBe(true);
    expect(ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: BuildStatus.failed }),
    );
    expect(githubService.findArtifactUrl).not.toHaveBeenCalled();
    expect(analyticsService.recordBuild).toHaveBeenCalledWith('user1', 'proj1', {
      platform: Platform.ios,
      environment: Environment.staging,
      status: BuildStatus.failed,
      durationSeconds: 120,
    });
  });
});
