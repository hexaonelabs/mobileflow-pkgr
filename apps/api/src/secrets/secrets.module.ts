import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { SecretsService } from './secrets.service';

@Module({
  imports: [CryptoModule],
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
