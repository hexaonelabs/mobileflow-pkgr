import { BadRequestException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { GithubWebhookController } from './github-webhook.controller';
import type { GithubWebhookService } from './github-webhook.service';

function createWebhookService() {
  return {
    verifySignature: jest.fn(),
    handleWorkflowRunEvent: jest.fn().mockResolvedValue(undefined),
    handlePushEvent: jest.fn().mockResolvedValue(undefined),
  };
}

function requestWith(rawBody: Buffer | undefined, body: unknown = {}) {
  return { rawBody, body } as unknown as RawBodyRequest<Request>;
}

describe('GithubWebhookController', () => {
  it('rejects when the signature header is missing', async () => {
    const webhookService = createWebhookService();
    const controller = new GithubWebhookController(
      webhookService as unknown as GithubWebhookService,
    );

    await expect(
      controller.handleWebhook(requestWith(Buffer.from('{}')), undefined, 'workflow_run'),
    ).rejects.toThrow(BadRequestException);
    expect(webhookService.verifySignature).not.toHaveBeenCalled();
  });

  it('rejects when the raw body is missing', async () => {
    const webhookService = createWebhookService();
    const controller = new GithubWebhookController(
      webhookService as unknown as GithubWebhookService,
    );

    await expect(
      controller.handleWebhook(requestWith(undefined), 'sha256=abc', 'workflow_run'),
    ).rejects.toThrow(BadRequestException);
    expect(webhookService.verifySignature).not.toHaveBeenCalled();
  });

  it('verifies the signature then ignores events other than workflow_run/push', async () => {
    const webhookService = createWebhookService();
    const controller = new GithubWebhookController(
      webhookService as unknown as GithubWebhookService,
    );
    const rawBody = Buffer.from('{}');

    const result = await controller.handleWebhook(requestWith(rawBody), 'sha256=abc', 'issues');

    expect(webhookService.verifySignature).toHaveBeenCalledWith(rawBody, 'sha256=abc');
    expect(webhookService.handleWorkflowRunEvent).not.toHaveBeenCalled();
    expect(webhookService.handlePushEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ ignored: true });
  });

  it('verifies the signature then forwards workflow_run events', async () => {
    const webhookService = createWebhookService();
    const controller = new GithubWebhookController(
      webhookService as unknown as GithubWebhookService,
    );
    const rawBody = Buffer.from('{"action":"completed"}');
    const payload = { action: 'completed' };

    const result = await controller.handleWebhook(
      requestWith(rawBody, payload),
      'sha256=abc',
      'workflow_run',
    );

    expect(webhookService.verifySignature).toHaveBeenCalledWith(rawBody, 'sha256=abc');
    expect(webhookService.handleWorkflowRunEvent).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ ok: true });
  });

  it('verifies the signature then forwards push events', async () => {
    const webhookService = createWebhookService();
    const controller = new GithubWebhookController(
      webhookService as unknown as GithubWebhookService,
    );
    const rawBody = Buffer.from('{"ref":"refs/heads/main"}');
    const payload = {
      ref: 'refs/heads/main',
      deleted: false,
      repository: { full_name: 'owner/repo' },
    };

    const result = await controller.handleWebhook(
      requestWith(rawBody, payload),
      'sha256=abc',
      'push',
    );

    expect(webhookService.verifySignature).toHaveBeenCalledWith(rawBody, 'sha256=abc');
    expect(webhookService.handlePushEvent).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ ok: true });
  });
});
