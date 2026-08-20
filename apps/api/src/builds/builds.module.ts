import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { GithubModule } from '../github/github.module';
import { InternalModule } from '../internal/internal.module';
import { StorageModule } from '../storage/storage.module';
import { BuildsService } from './builds.service';
import { PublicBuildsController } from './public-builds.controller';

@Module({
  imports: [GithubModule, InternalModule, StorageModule, AnalyticsModule],
  controllers: [PublicBuildsController],
  providers: [BuildsService],
  exports: [BuildsService],
})
export class BuildsModule {}
