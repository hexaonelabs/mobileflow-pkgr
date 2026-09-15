import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { BuildLogsIngestionController } from './build-logs-ingestion.controller';
import type { BuildsService } from './builds.service';
import type { LogsTokensService } from '../internal/logs-tokens.service';

describe('BuildLogsIngestionController.appendLogs', () => {
  it('verifies the bearer token against the build id then forwards the chunk', async () => {
    const logsTokens = { verifyToken: jest.fn().mockResolvedValue({ buildId: 'build1' }) };
    const buildsService = { appendLiveLog: jest.fn() };
    const controller = new BuildLogsIngestionController(
      logsTokens as unknown as LogsTokensService,
      buildsService as unknown as BuildsService,
    );

    const result = await controller.appendLogs('build1', 'Bearer token123', 'npm ci\n');

    expect(logsTokens.verifyToken).toHaveBeenCalledWith('token123', 'build1');
    expect(buildsService.appendLiveLog).toHaveBeenCalledWith('build1', 'npm ci\n');
    expect(result).toEqual({ ok: true });
  });

  it('rejects a missing authorization header without checking the token store', async () => {
    const logsTokens = { verifyToken: jest.fn() };
    const buildsService = { appendLiveLog: jest.fn() };
    const controller = new BuildLogsIngestionController(
      logsTokens as unknown as LogsTokensService,
      buildsService as unknown as BuildsService,
    );

    await expect(controller.appendLogs('build1', undefined, 'text')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(logsTokens.verifyToken).not.toHaveBeenCalled();
    expect(buildsService.appendLiveLog).not.toHaveBeenCalled();
  });

  it('propagates a token rejection from LogsTokensService', async () => {
    const logsTokens = {
      verifyToken: jest.fn().mockRejectedValue(new UnauthorizedException('Token invalide.')),
    };
    const buildsService = { appendLiveLog: jest.fn() };
    const controller = new BuildLogsIngestionController(
      logsTokens as unknown as LogsTokensService,
      buildsService as unknown as BuildsService,
    );

    await expect(controller.appendLogs('build1', 'Bearer bad', 'text')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(buildsService.appendLiveLog).not.toHaveBeenCalled();
  });

  it('rejects a non-string body', async () => {
    const logsTokens = { verifyToken: jest.fn().mockResolvedValue({ buildId: 'build1' }) };
    const buildsService = { appendLiveLog: jest.fn() };
    const controller = new BuildLogsIngestionController(
      logsTokens as unknown as LogsTokensService,
      buildsService as unknown as BuildsService,
    );

    await expect(controller.appendLogs('build1', 'Bearer token123', undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(buildsService.appendLiveLog).not.toHaveBeenCalled();
  });

  it('rejects a chunk over the size cap', async () => {
    const logsTokens = { verifyToken: jest.fn().mockResolvedValue({ buildId: 'build1' }) };
    const buildsService = { appendLiveLog: jest.fn() };
    const controller = new BuildLogsIngestionController(
      logsTokens as unknown as LogsTokensService,
      buildsService as unknown as BuildsService,
    );

    await expect(
      controller.appendLogs('build1', 'Bearer token123', 'x'.repeat(80_001)),
    ).rejects.toThrow(BadRequestException);
    expect(buildsService.appendLiveLog).not.toHaveBeenCalled();
  });
});
