import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./modules/health/health.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { DrizzleModule } from "./drizzle/drizzle.module";
import { validateEnv } from "./config/env.validation";
import configuration from "./config/configuration";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    DrizzleModule,
    HealthModule,
    PaymentsModule,
  ],
})
export class AppModule {}
