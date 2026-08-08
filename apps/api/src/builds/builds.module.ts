import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { BuildsService } from './builds.service';

@Module({
  imports: [GithubModule],
  providers: [BuildsService],
  exports: [BuildsService],
})
export class BuildsModule {}
