import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { SUPABASE_DB } from "../../src/drizzle/drizzle.module";
import { HealthModule } from "../../src/modules/health/health.module";
import { AuthModule } from "../../src/modules/auth/auth.module";
import { PaymentsModule } from "../../src/modules/payments/payments.module";
import { EmailsService } from "../../src/modules/emails/emails.service";
import { SupabaseJwtGuard } from "../../src/common/guards/supabase-jwt.guard";
import { fakeDb } from "./fake-db";

export const TEST_JWT_SECRET = "test-secret-must-be-long-enough-abcdef";

@Global()
@Module({
  providers: [
    { provide: SUPABASE_DB, useValue: fakeDb() },
    // Stub EmailsService — AuthController's email-hook endpoint depends on it,
    // but E2E doesn't actually render templates. Enqueue is a no-op.
    { provide: EmailsService, useValue: { send: async () => undefined } },
  ],
  exports: [SUPABASE_DB, EmailsService],
})
class TestDrizzleModule {}

/**
 * E2E boots the HTTP surface with an in-memory DB stand-in — proves
 * versioning, guards, DTO validation, and controller wiring without any
 * real infra. Domain-level behavior (state machine, advisory locks, wallet
 * credits) belongs in the integration tier.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [
        () => ({
          appEnv: "test",
          port: 0,
          supabase: {
            url: "http://localhost:8000",
            anonKey: "anon-test",
            serviceRoleKey: "service-test",
            jwtSecret: TEST_JWT_SECRET,
            dbUrl: "postgres://x",
          },
          monnify: {
            baseUrl: "https://monnify.test",
            apiKey: "MK_TEST",
            secretKey: "SK_TEST",
            contractCode: "TEST_CONTRACT",
            webhookSecret: "WH_TEST",
          },
          platform: { feeBps: 250 },
        }),
      ],
    }),
    TestDrizzleModule,
    HealthModule,
    AuthModule,
    PaymentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: SupabaseJwtGuard }],
})
export class TestAppModule {}
