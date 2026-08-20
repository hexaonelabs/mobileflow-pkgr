import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BuildsModule } from './builds/builds.module';
import { FirestoreModule } from './firestore/firestore.module';
import { GithubModule } from './github/github.module';
import { GithubWebhookModule } from './github/github-webhook.module';
import { InternalModule } from './internal/internal.module';
import { ProjectsModule } from './projects/projects.module';
import { QueueModule } from './queue/queue.module';
import { SecretsModule } from './secrets/secrets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    FirestoreModule,
    QueueModule,
    AuthModule,
    GithubModule,
    ProjectsModule,
    BuildsModule,
    GithubWebhookModule,
    AnalyticsModule,
    SecretsModule,
    InternalModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
