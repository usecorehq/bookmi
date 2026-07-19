import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { EmailsModule } from "./modules/emails/emails.module";
import { HostsModule } from "./modules/hosts/hosts.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PublicModule } from "./modules/public/public.module";
import { DrizzleModule } from "./drizzle/drizzle.module";
import { QueuesModule } from "./common/queues/queues.module";
import { AdminQueuesModule } from "./modules/admin/admin-queues.module";
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
    // QueuesModule sets up the shared ioredis connection + BullMQ root wiring.
    // Every feature module that registers a queue depends on this.
    QueuesModule,
    DrizzleModule,
    EmailsModule,
    HealthModule,
    AuthModule,
    HostsModule,
    PaymentsModule,
    PublicModule,
    AdminQueuesModule,
  ],
  providers: [
    // Global auth: every route requires a valid Supabase JWT unless the
    // controller or handler is decorated with @Public().
    { provide: APP_GUARD, useClass: SupabaseJwtGuard },
  ],
})
export class AppModule {}
