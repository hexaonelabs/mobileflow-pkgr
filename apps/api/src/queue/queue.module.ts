import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';

@Module({
  imports: [
    BullModule.forRoot({
      connection: new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
