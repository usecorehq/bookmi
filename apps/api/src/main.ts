import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { AppModule } from "./app.module";
import { createBullBoardBasicAuthMiddleware } from "./modules/admin/bull-board-basic-auth.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Webhook signature verification needs the untouched request bytes.
    rawBody: true,
    logger: ["error", "warn", "log"],
  });

  const config = app.get(ConfigService);

  // Bull Board mounts a raw Express router at /api/admin/queues that bypasses
  // Nest's guard pipeline — protect it with HTTP Basic Auth registered here,
  // BEFORE any Nest module init runs, so nothing downstream can shadow it.
  app.use("/api/admin/queues", createBullBoardBasicAuthMiddleware(config));

  app.setGlobalPrefix("api");

  // Auth is a Bearer header, never cookies — keep CORS credential-free so
  // responses stay cacheable and origins stay an explicit allowlist.
  app.enableCors({
    origin: config.get<string[]>('corsOrigins') ?? [],
  });


  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  // Swagger — always on in dev, harmless in prod behind an ingress rule.
  // Paste a Supabase access_token into the Authorize button; every request
  // then flies with `Authorization: Bearer <jwt>`.
  const swaggerCfg = new DocumentBuilder()
    .setTitle("bookmi-api")
    .setDescription(
      "Bookmi backend — payments, bookings, wallets, payouts. Auth: paste your Supabase access_token below.",
    )
    .setVersion("0.0.1")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "bearer",
    )
    .build();

  SwaggerModule.setup(
    "docs",
    app,
    cleanupOpenApiDoc(SwaggerModule.createDocument(app, swaggerCfg)),
    { swaggerOptions: { persistAuthorization: true } },
  );

  const port = config.get<number>("port", 4000);

  await app.listen(port);
  new Logger("Bootstrap").log(`Bookmi API listening on http://localhost:${port}/api`);
  new Logger("Bootstrap").log(`Swagger UI: http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  new Logger("Bootstrap").error("Fatal boot error", err);
  process.exit(1);
});
