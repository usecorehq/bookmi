import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Webhook signature verification needs the untouched request bytes.
    rawBody: true,
    logger: ["error", "warn", "log"],
  });

  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(ConfigService);
  const port = config.get<number>("port", 4000);

  await app.listen(port);
  new Logger("Bootstrap").log(`Bookmi API listening on http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  new Logger("Bootstrap").error("Fatal boot error", err);
  process.exit(1);
});
