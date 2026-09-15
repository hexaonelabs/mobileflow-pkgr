import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { LogsTokensService } from '../internal/logs-tokens.service';
import { BuildsService } from './builds.service';

// Endpoint machine-à-machine appelé par le shipper de logs du run GitHub Actions (jamais par le
// navigateur) : pas de JwtAuthGuard, authentification par le logs_token à courte durée de vie
// vérifié via LogsTokensService (cf. workflow-template.ts, étape "Démarrer le shipper de logs").
@Controller('internal/builds')
export class BuildLogsIngestionController {
  constructor(
    private readonly logsTokens: LogsTokensService,
    private readonly buildsService: BuildsService,
  ) {}

  @Post(':buildId/logs')
  async appendLogs(
    @Param('buildId') buildId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body('text') text: unknown,
  ) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null;
    if (!token) {
      throw new UnauthorizedException('Token manquant.');
    }
    await this.logsTokens.verifyToken(token, buildId);

    if (typeof text !== 'string' || text.length === 0) {
      throw new BadRequestException('Corps de requête invalide.');
    }
    if (text.length > 80_000) {
      throw new BadRequestException('Chunk de logs trop volumineux.');
    }

    this.buildsService.appendLiveLog(buildId, text);
    return { ok: true };
  }
}
