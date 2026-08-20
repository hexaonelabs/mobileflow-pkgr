import { Module } from '@nestjs/common';
import { BuildsModule } from '../builds/builds.module';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubWebhookService } from './github-webhook.service';

// Module dédié (plutôt qu'intégré à GithubModule) pour éviter la dépendance circulaire :
// GithubWebhookService dépend de BuildsService, et BuildsModule importe déjà GithubModule
// (pour GithubService). En important BuildsModule ici sans que BuildsModule ait besoin de
// réimporter ce module, aucun forwardRef() n'est nécessaire.
@Module({
  imports: [BuildsModule],
  controllers: [GithubWebhookController],
  providers: [GithubWebhookService],
})
export class GithubWebhookModule {}
