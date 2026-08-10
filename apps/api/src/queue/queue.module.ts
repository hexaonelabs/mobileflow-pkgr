import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

const logger = new Logger('QueueModule');

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';

        return {
          connection: createRedisConnection(redisUrl),
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}

function createRedisConnection(redisUrl: string): IORedis {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });
  let hasLoggedRedisConnectionError = false;

  connection.on('error', (error: Error) => {
    if (hasLoggedRedisConnectionError) {
      return;
    }

    hasLoggedRedisConnectionError = true;
    logger.error(
      `Redis connection failed at ${formatRedisUrl(redisUrl)}. Start Redis locally or update REDIS_URL. ${error.message}`,
    );
  });

  return connection;
}

function formatRedisUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return value;
  }
}
