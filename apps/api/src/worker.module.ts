import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AppModule } from "./app.module";
import { WorkersModule } from "./workers.module";

/**
 * Composed module for the `APP_ROLE=worker` process. Reuses `AppModule` for
 * infrastructure (config, drizzle, queues root, emails, providers…) then
 * layers on the scheduler runtime + BullMQ processors that make the worker
 * actually do work.
 *
 * `ScheduleModule.forRoot()` powers classic `@Cron` / `@Interval` /
 * `@Timeout` decorators. Bookmi's current schedulers use BullMQ repeatable
 * jobs (Redis-owned schedule, HA-safe) — keeping `ScheduleModule` wired
 * means future fixed-schedule tasks can use either mechanism without more
 * plumbing.
 */
@Module({
  imports: [AppModule, ScheduleModule.forRoot(), WorkersModule],
})
export class WorkerModule {}
