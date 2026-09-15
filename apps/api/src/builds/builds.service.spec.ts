import { ForbiddenException } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildStatus, Environment, TriggeredBy, type BuildDocument } from './build.model';
import { Platform } from '../projects/project.model';
import { Plan } from '../users/user.model';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { FirestoreService } from '../firestore/firestore.service';
import type { GithubService } from '../github/github.service';
import type { LogsTokensService } from '../internal/logs-tokens.service';
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
    githubJobId: null,
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
      return await fn(tx);
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
  let logsTokensService: { revokeToken: jest.Mock };

  function createService(freshFirestoreState: BuildDocument): BuildsService {
    return new BuildsService(
      createFirestoreWithTransaction(freshFirestoreState),
      githubService as unknown as GithubService,
      undefined as never,
      logsTokensService as unknown as LogsTokensService,
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
    logsTokensService = { revokeToken: jest.fn().mockResolvedValue(undefined) };
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
    expect(ref.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: BuildStatus.success }),
    );
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
    expect(logsTokensService.revokeToken).toHaveBeenCalledTimes(1);
  });
});

describe('BuildsService.getBuildLogs', () => {
  function createFirestoreForBuild(
    buildData: BuildDocument,
    updateSpy: jest.Mock,
  ): FirestoreService {
    return {
      db: {
        collection: jest.fn((name: string) => {
          if (name === 'projects') {
            return {
              doc: jest.fn().mockReturnValue({
                get: jest.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({ userId: 'user1', githubRepoFullName: 'owner/repo' }),
                }),
              }),
            };
          }
          return {
            doc: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue({ exists: true, data: () => buildData }),
              update: updateSpy,
            }),
          };
        }),
      },
    } as unknown as FirestoreService;
  }

  function createService(
    buildData: BuildDocument,
    githubService: {
      findRelevantJobId: jest.Mock;
      downloadJobLogsText: jest.Mock;
    },
  ): { service: BuildsService; updateSpy: jest.Mock } {
    const updateSpy = jest
      .fn<Promise<void>, [Partial<BuildDocument>]>()
      .mockResolvedValue(undefined);
    const service = new BuildsService(
      createFirestoreForBuild(buildData, updateSpy),
      githubService as unknown as GithubService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    return { service, updateSpy };
  }

  describe('active build (buffer live poussé par le shipper du workflow)', () => {
    it('never calls GitHub while the build is active, even with a known githubJobId', async () => {
      const data = buildDocument({ status: BuildStatus.running, githubRunId: 42, githubJobId: 99 });
      const githubService = {
        findRelevantJobId: jest.fn(),
        downloadJobLogsText: jest.fn(),
      };
      const { service } = createService(data, githubService);

      const result = await service.getBuildLogs('user1', 'proj1', 'build1', 0);

      expect(result).toEqual({ text: '', nextOffset: 0, isComplete: false, expired: false });
      expect(githubService.findRelevantJobId).not.toHaveBeenCalled();
      expect(githubService.downloadJobLogsText).not.toHaveBeenCalled();
    });

    it('serves whatever the shipper has pushed to the live buffer so far', async () => {
      const data = buildDocument({ status: BuildStatus.running, githubRunId: 42, githubJobId: 99 });
      const githubService = { findRelevantJobId: jest.fn(), downloadJobLogsText: jest.fn() };
      const { service } = createService(data, githubService);

      service.appendLiveLog('build1', 'npm ci\n');
      service.appendLiveLog('build1', 'npm run build\n');

      const result = await service.getBuildLogs('user1', 'proj1', 'build1', 0);

      expect(result).toEqual({
        text: 'npm ci\nnpm run build\n',
        nextOffset: 21,
        isComplete: false,
        expired: false,
      });
      expect(githubService.downloadJobLogsText).not.toHaveBeenCalled();
    });

    it('slices the live buffer by offset like a normal delta poll', async () => {
      const data = buildDocument({ status: BuildStatus.running, githubRunId: 42, githubJobId: 99 });
      const githubService = { findRelevantJobId: jest.fn(), downloadJobLogsText: jest.fn() };
      const { service } = createService(data, githubService);

      service.appendLiveLog('build1', 'line 1\n');
      service.appendLiveLog('build1', 'line 2\n');

      const result = await service.getBuildLogs('user1', 'proj1', 'build1', 7);

      expect(result).toEqual({
        text: 'line 2\n',
        nextOffset: 14,
        isComplete: false,
        expired: false,
      });
    });
  });

  describe('finished build (texte GitHub officiel, complet, offset ignoré)', () => {
    it('resolves and persists githubJobId lazily when not yet known', async () => {
      const data = buildDocument({
        status: BuildStatus.success,
        githubRunId: 42,
        githubJobId: null,
      });
      const githubService = {
        findRelevantJobId: jest.fn().mockResolvedValue(99),
        downloadJobLogsText: jest.fn().mockResolvedValue({ text: 'line 1\n', expired: false }),
      };
      const { service, updateSpy } = createService(data, githubService);

      const result = await service.getBuildLogs('user1', 'proj1', 'build1', 0);

      expect(githubService.findRelevantJobId).toHaveBeenCalledWith('user1', 'owner/repo', 42);
      expect(updateSpy).toHaveBeenCalledWith({ githubJobId: 99 });
      expect(githubService.downloadJobLogsText).toHaveBeenCalledWith('user1', 'owner/repo', 99);
      expect(result).toEqual({ text: 'line 1\n', nextOffset: 7, isComplete: true, expired: false });
    });

    it('returns the full text ignoring the offset (live buffer and GitHub text are different formats)', async () => {
      const data = buildDocument({ status: BuildStatus.success, githubRunId: 42, githubJobId: 99 });
      const githubService = {
        findRelevantJobId: jest.fn(),
        downloadJobLogsText: jest
          .fn()
          .mockResolvedValue({ text: 'line 1\nline 2\n', expired: false }),
      };
      const { service } = createService(data, githubService);

      const result = await service.getBuildLogs('user1', 'proj1', 'build1', 999);

      expect(githubService.findRelevantJobId).not.toHaveBeenCalled();
      expect(result).toEqual({
        text: 'line 1\nline 2\n',
        nextOffset: 14,
        isComplete: true,
        expired: false,
      });
    });

    it('reports isComplete without a job id when the build finished without a correlated run', async () => {
      const data = buildDocument({
        status: BuildStatus.cancelled,
        githubRunId: null,
        githubJobId: null,
      });
      const githubService = { findRelevantJobId: jest.fn(), downloadJobLogsText: jest.fn() };
      const { service } = createService(data, githubService);

      const result = await service.getBuildLogs('user1', 'proj1', 'build1', 0);

      expect(result).toEqual({ text: '', nextOffset: 0, isComplete: true, expired: false });
      expect(githubService.findRelevantJobId).not.toHaveBeenCalled();
    });

    it('reports expired logs (GitHub 404, past the 90-day retention window) without throwing', async () => {
      const data = buildDocument({ status: BuildStatus.success, githubRunId: 42, githubJobId: 99 });
      const githubService = {
        findRelevantJobId: jest.fn(),
        downloadJobLogsText: jest.fn().mockResolvedValue({ text: '', expired: true }),
      };
      const { service } = createService(data, githubService);

      const result = await service.getBuildLogs('user1', 'proj1', 'build1', 0);

      expect(result).toEqual({ text: '', nextOffset: 0, isComplete: true, expired: true });
    });

    it('marks isComplete once the build reached a terminal status', async () => {
      const data = buildDocument({ status: BuildStatus.failed, githubRunId: 42, githubJobId: 99 });
      const githubService = {
        findRelevantJobId: jest.fn(),
        downloadJobLogsText: jest.fn().mockResolvedValue({ text: 'boom\n', expired: false }),
      };
      const { service } = createService(data, githubService);

      const result = await service.getBuildLogs('user1', 'proj1', 'build1', 0);

      expect(result.isComplete).toBe(true);
    });
  });
});

describe('BuildsService.appendLiveLog', () => {
  function createBareService(): BuildsService {
    return new BuildsService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
  }

  function bufferOf(service: BuildsService) {
    return (
      service as unknown as { liveLogsBuffer: Map<string, { text: string; expiresAt: number }> }
    ).liveLogsBuffer;
  }

  it('accumulates chunks for the same build across multiple calls', () => {
    const service = createBareService();
    service.appendLiveLog('build1', 'a');
    service.appendLiveLog('build1', 'b');
    service.appendLiveLog('build1', 'c');

    expect(bufferOf(service).get('build1')?.text).toBe('abc');
  });

  it('keeps separate buffers per build', () => {
    const service = createBareService();
    service.appendLiveLog('build1', 'foo');
    service.appendLiveLog('build2', 'bar');

    expect(bufferOf(service).get('build1')?.text).toBe('foo');
    expect(bufferOf(service).get('build2')?.text).toBe('bar');
  });

  it('stops accepting new chunks once the per-build size cap is reached', () => {
    const service = createBareService();
    service.appendLiveLog('build1', 'x'.repeat(5 * 1024 * 1024));
    const sizeAtCap = bufferOf(service).get('build1')?.text.length;

    service.appendLiveLog('build1', 'overflow');

    expect(bufferOf(service).get('build1')?.text.length).toBe(sizeAtCap);
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
