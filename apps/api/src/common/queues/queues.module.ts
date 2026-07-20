import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";

/**
 * Root BullMQ wiring. Everything that touches queues — producers (HTTP
 * handlers, purpose handlers) and processors (`@Processor` classes) —
 * depends on this module.
 *
 *   - `db: config.redis.queueDb` (default 1) so it doesn't collide with the
 *     Redis DB anything else might grab.
 *   - `prefix: 'bull'` for a clean key namespace.
 *   - `maxRetriesPerRequest: null` — BullMQ hard-requires this.
 *   - Default job retention: keep the last 1000 completed / 7 days; last
 *     5000 failed. Redis grows unbounded without this.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>("redis.host"),
          port: config.getOrThrow<number>("redis.port"),
          password: config.get<string>("redis.password") || undefined,
          db: config.get<number>("redis.queueDb") ?? 1,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        },
        prefix: "bull",
        defaultJobOptions: {
          removeOnComplete: { count: 1000, age: 7 * 24 * 3600 },
          removeOnFail: { count: 5000 },
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
