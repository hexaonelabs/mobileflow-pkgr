import { Module } from '@nestjs/common';
import { BuildsModule } from '../builds/builds.module';
import { GithubModule } from '../github/github.module';
import { QuotasModule } from '../quotas/quotas.module';
import { SecretsModule } from '../secrets/secrets.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [GithubModule, BuildsModule, SecretsModule, QuotasModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
