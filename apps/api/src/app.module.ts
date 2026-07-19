import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HostsModule } from "./modules/hosts/hosts.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { DrizzleModule } from "./drizzle/drizzle.module";
import { SupabaseJwtGuard } from "./common/guards/supabase-jwt.guard";
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
    AuthModule,
    HostsModule,
    PaymentsModule,
  ],
  providers: [
    // Global auth: every route requires a valid Supabase JWT unless the
    // controller or handler is decorated with @Public().
    { provide: APP_GUARD, useClass: SupabaseJwtGuard },
  ],
})
export class AppModule {}
