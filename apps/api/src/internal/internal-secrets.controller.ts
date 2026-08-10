import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';
import { RunTokensService } from './run-tokens.service';

// Endpoint machine-à-machine appelé par le run GitHub Actions (jamais par le navigateur) :
// pas de JwtAuthGuard, l'authentification se fait par un token de run à courte durée de vie
// (cf. RunTokensService), généré au déclenchement du build et transmis en input workflow_dispatch.
@Controller('internal/secrets')
export class InternalSecretsController {
  constructor(
    private readonly runTokens: RunTokensService,
    private readonly secretsService: SecretsService,
  ) {}

  @Get()
  async getSecrets(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null;
    if (!token) {
      throw new UnauthorizedException('Token manquant.');
    }
    const { projectId, userId, platform } = await this.runTokens.consumeToken(token);
    return this.secretsService.getDecryptedForPlatform(userId, projectId, platform);
  }
}
