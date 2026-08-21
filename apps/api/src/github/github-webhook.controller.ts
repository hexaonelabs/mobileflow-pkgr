import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  GithubWebhookService,
  type PushWebhookPayload,
  type WorkflowRunWebhookPayload,
} from './github-webhook.service';

// Endpoint public (pas de JwtAuthGuard) : authentifié par la signature HMAC GitHub
// (x-hub-signature-256), pas par un token utilisateur — cf. GithubWebhookService.verifySignature.
@Controller('github')
export class GithubWebhookController {
  constructor(private readonly webhookService: GithubWebhookService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ) {
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Signature manquante.');
    }
    this.webhookService.verifySignature(req.rawBody, signature);

    if (event === 'workflow_run') {
      await this.webhookService.handleWorkflowRunEvent(req.body as WorkflowRunWebhookPayload);
      return { ok: true };
    }
    if (event === 'push') {
      await this.webhookService.handlePushEvent(req.body as PushWebhookPayload);
      return { ok: true };
    }
    return { ignored: true };
  }
}
