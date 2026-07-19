import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
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
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swaggerCfg), {
    swaggerOptions: { persistAuthorization: true },
  });

  const config = app.get(ConfigService);
  const port = config.get<number>("port", 4000);

  await app.listen(port);
  new Logger("Bootstrap").log(`Bookmi API listening on http://localhost:${port}/api`);
  new Logger("Bootstrap").log(`Swagger UI: http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  new Logger("Bootstrap").error("Fatal boot error", err);
  process.exit(1);
});
