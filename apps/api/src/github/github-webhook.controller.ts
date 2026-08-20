import { BadRequestException, Controller, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GithubWebhookService } from './github-webhook.service';

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

    if (event !== 'workflow_run') {
      return { ignored: true };
    }
    await this.webhookService.handleWorkflowRunEvent(req.body);
    return { ok: true };
  }
}
