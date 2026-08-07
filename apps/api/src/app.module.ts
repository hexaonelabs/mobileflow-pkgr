import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FirestoreModule } from './firestore/firestore.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), FirestoreModule, QueueModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
