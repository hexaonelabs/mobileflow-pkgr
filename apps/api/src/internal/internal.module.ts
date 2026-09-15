import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { InternalSecretsController } from './internal-secrets.controller';
import { LogsTokensService } from './logs-tokens.service';
import { RunTokensService } from './run-tokens.service';

@Module({
  imports: [SecretsModule],
  controllers: [InternalSecretsController],
  providers: [RunTokensService, LogsTokensService],
  exports: [RunTokensService, LogsTokensService],
})
export class InternalModule {}
