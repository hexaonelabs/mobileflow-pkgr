import { Module } from '@nestjs/common';
import { AppleCertificateService } from './apple-certificate.service';

@Module({
  providers: [AppleCertificateService],
  exports: [AppleCertificateService],
})
export class AppleModule {}
