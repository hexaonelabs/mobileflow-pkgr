import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BuildsModule } from './builds/builds.module';
import { FirestoreModule } from './firestore/firestore.module';
import { GithubModule } from './github/github.module';
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
    SecretsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
