import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { WorkerModule } from "./worker.module";

/**
 * Bootstrap for `APP_ROLE=worker` — headless: schedulers + BullMQ consumers.
 *
 * No HTTP server, no Swagger, no Bull Board. Just a Nest application context
 * that keeps the event loop alive via Bull workers + any registered `@Cron`
 * handlers. `enableShutdownHooks()` plus Bull's default drain behavior means
 * SIGTERM (Coolify rolling-deploy signal) waits for in-flight jobs to finish
 * before the process exits.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();

  new Logger("Bootstrap:worker").log(
    "Worker ready — schedulers + BullMQ consumers active",
  );
}

bootstrap().catch((err) => {
  new Logger("Bootstrap:worker").error("Fatal worker bootstrap error", err);
  process.exit(1);
});
