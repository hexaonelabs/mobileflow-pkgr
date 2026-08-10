import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { InternalSecretsController } from './internal-secrets.controller';
import { RunTokensService } from './run-tokens.service';

@Module({
  imports: [SecretsModule],
  controllers: [InternalSecretsController],
  providers: [RunTokensService],
  exports: [RunTokensService],
})
export class InternalModule {}
