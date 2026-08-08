import { Module } from '@nestjs/common';
import { BuildsModule } from '../builds/builds.module';
import { GithubModule } from '../github/github.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [GithubModule, BuildsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
