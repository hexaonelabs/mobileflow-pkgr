import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { GithubModule } from '../github/github.module';
import { InternalModule } from '../internal/internal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { BuildsService } from './builds.service';
import { PublicBuildsController } from './public-builds.controller';

@Module({
  imports: [GithubModule, InternalModule, StorageModule, AnalyticsModule, NotificationsModule],
  controllers: [PublicBuildsController],
  providers: [BuildsService],
  exports: [BuildsService],
})
export class BuildsModule {}
