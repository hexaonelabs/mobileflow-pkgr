import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookService } from './stripe-webhook.service';

// Endpoint public (pas de JwtAuthGuard) — authentifié par la signature Stripe, même pattern
// que GithubWebhookController.
@Controller('stripe')
export class StripeWebhookController {
  constructor(private readonly stripeWebhookService: StripeWebhookService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Signature manquante.');
    }
    const event = this.stripeWebhookService.constructEvent(req.rawBody, signature);
    await this.stripeWebhookService.handleEvent(event);
    return { ok: true };
  }
}
