import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { BuildsModule } from './builds/builds.module';
import { FirestoreModule } from './firestore/firestore.module';
import { GithubModule } from './github/github.module';
import { GithubWebhookModule } from './github/github-webhook.module';
import { InternalModule } from './internal/internal.module';
import { NotificationsModule } from './notifications/notifications.module';
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
    NotificationsModule,
    SecretsModule,
    InternalModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
