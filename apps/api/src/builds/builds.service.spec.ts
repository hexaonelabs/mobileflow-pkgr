import { ForbiddenException } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildStatus, Environment, TriggeredBy, type BuildDocument } from './build.model';
import { Platform } from '../projects/project.model';
import { Plan } from '../users/user.model';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { FirestoreService } from '../firestore/firestore.service';
import type { GithubService } from '../github/github.service';
import type { NotificationsService } from '../notifications/notifications.service';

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

// Simule les transactions Firestore avec une isolation sérialisable : les appels
// concurrents à runTransaction() sont mis en file (comme le ferait réellement Firestore
// pour deux transactions qui touchent le même document), de sorte que la seconde
// transaction voit toujours l'état déjà validé par la première.
function createFirestoreWithTransaction(initialData: BuildDocument) {
  let current = { ...initialData };
  let lock: Promise<unknown> = Promise.resolve();
  const runTransaction = jest.fn((fn: (tx: { get: jest.Mock; update: jest.Mock }) => unknown) => {
    const run = lock.then(async () => {
      const tx = {
        get: jest.fn().mockResolvedValue({ data: () => current }),
        update: jest.fn((_ref: unknown, patch: Partial<BuildDocument>) => {
          current = { ...current, ...patch };
        }),
      };
      return fn(tx);
    });
    lock = run.catch(() => undefined);
    return run;
  });

  return {
    db: {
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ userId: 'user1', githubRepoFullName: 'owner/repo' }),
          }),
        }),
      }),
      runTransaction,
    },
  } as unknown as FirestoreService;
}

describe('BuildsService.finalizeBuildStatus', () => {
  let githubService: { findArtifactUrl: jest.Mock };
  let analyticsService: { recordBuild: jest.Mock };
  let notificationsService: { onBuildStatusChanged: jest.Mock };

  function createService(freshFirestoreState: BuildDocument): BuildsService {
    return new BuildsService(
      createFirestoreWithTransaction(freshFirestoreState),
      githubService as unknown as GithubService,
      undefined as never,
      undefined as never,
      undefined as never,
      analyticsService as unknown as AnalyticsService,
      notificationsService as unknown as NotificationsService,
    );
  }

  beforeEach(() => {
    githubService = {
      findArtifactUrl: jest.fn().mockResolvedValue('https://github.com/owner/repo/artifact'),
    };
    analyticsService = { recordBuild: jest.fn().mockResolvedValue(undefined) };
    notificationsService = { onBuildStatusChanged: jest.fn().mockResolvedValue(undefined) };
  });

  it('finalizes a successful run: sets finishedAt/duration and resolves the artifact URL', async () => {
    const data = buildDocument();
    const ref = createRef(buildDocument({ status: BuildStatus.success }));
    const service = createService(data);

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
    // finishedAt/durationSeconds are now committed atomically inside the Firestore
    // transaction (see createFirestoreWithTransaction), not via the outer ref.update().
    expect(ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: BuildStatus.success }));
    expect(ref.update.mock.calls[0][0].durationSeconds).toBeUndefined();
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
    expect(notificationsService.onBuildStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: 'build1',
        projectId: 'proj1',
        userId: 'user1',
        status: BuildStatus.success,
        durationSeconds: 60,
      }),
    );
  });

  it('is idempotent: does not touch finishedAt/duration/artifactUrl when the build is already finished', async () => {
    const data = buildDocument({
      status: BuildStatus.success,
      finishedAt: 'already-set' as never,
      artifactUrl: 'already-set',
    });
    const ref = createRef(data);
    const service = createService(data);

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
    expect(notificationsService.onBuildStatusChanged).not.toHaveBeenCalled();
  });

  it('maps a failed conclusion to BuildStatus.failed without touching artifactUrl', async () => {
    const data = buildDocument();
    const ref = createRef(buildDocument({ status: BuildStatus.failed }));
    const service = createService(data);

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
    expect(notificationsService.onBuildStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: 'build1',
        projectId: 'proj1',
        userId: 'user1',
        status: BuildStatus.failed,
        durationSeconds: 120,
      }),
    );
  });

  it('regression: concurrent calls (GitHub webhook + client polling) for the same build only fire Analytics/Notifications once', async () => {
    // Both "callers" hold the same stale, already-read `data` snapshot — exactly what
    // happens when the webhook and the client poll fetch the build doc a few
    // milliseconds apart, before either has written finishedAt.
    const staleData = buildDocument();
    const ref = createRef(buildDocument({ status: BuildStatus.failed }));
    const service = createService(staleData);
    const run = {
      status: 'completed',
      conclusion: 'failure',
      htmlUrl: 'https://github.com/owner/repo/actions/runs/1',
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:02:00.000Z',
    };

    const [first, second] = await Promise.all([
      service.finalizeBuildStatus('user1', 'proj1', 'build1', ref as never, staleData, run),
      service.finalizeBuildStatus('user1', 'proj1', 'build1', ref as never, staleData, run),
    ]);

    expect([first.isFinished, second.isFinished].filter(Boolean)).toHaveLength(1);
    expect(analyticsService.recordBuild).toHaveBeenCalledTimes(1);
    expect(notificationsService.onBuildStatusChanged).toHaveBeenCalledTimes(1);
  });
});

describe('BuildsService.create - production plan gating', () => {
  function createFirestoreForOwnedProject(): FirestoreService {
    return {
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
  }

  function createService(githubService: { getBranchHeadSha: jest.Mock }): BuildsService {
    return new BuildsService(
      createFirestoreForOwnedProject(),
      githubService as unknown as GithubService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
  }

  it('rejects a production build for a free-plan user without ever calling GitHub', async () => {
    const githubService = { getBranchHeadSha: jest.fn() };
    const service = createService(githubService);

    await expect(
      service.create('user1', 'proj1', Plan.free, {
        environment: Environment.production,
        platforms: [Platform.android],
        branch: 'main',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(githubService.getBranchHeadSha).not.toHaveBeenCalled();
  });

  it('lets a paid-plan user past the gate for a production build', async () => {
    const sentinel = new Error('past the plan gate');
    const githubService = { getBranchHeadSha: jest.fn().mockRejectedValue(sentinel) };
    const service = createService(githubService);

    await expect(
      service.create('user1', 'proj1', Plan.starter, {
        environment: Environment.production,
        platforms: [Platform.android],
        branch: 'main',
      }),
    ).rejects.toBe(sentinel);
  });

  it('lets a free-plan user past the gate for a staging build', async () => {
    const sentinel = new Error('past the plan gate');
    const githubService = { getBranchHeadSha: jest.fn().mockRejectedValue(sentinel) };
    const service = createService(githubService);

    await expect(
      service.create('user1', 'proj1', Plan.free, {
        environment: Environment.staging,
        platforms: [Platform.android],
        branch: 'main',
      }),
    ).rejects.toBe(sentinel);
  });
});
