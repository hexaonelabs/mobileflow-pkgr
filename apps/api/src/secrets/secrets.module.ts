import { Module } from '@nestjs/common';
import { AppleModule } from '../apple/apple.module';
import { CryptoModule } from '../crypto/crypto.module';
import { SecretsService } from './secrets.service';

@Module({
  imports: [CryptoModule, AppleModule],
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
