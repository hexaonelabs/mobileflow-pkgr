import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { InternalModule } from '../internal/internal.module';
import { BuildsService } from './builds.service';

@Module({
  imports: [GithubModule, InternalModule],
  providers: [BuildsService],
  exports: [BuildsService],
})
export class BuildsModule {}
