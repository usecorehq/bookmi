import { plainToInstance, Transform } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from "class-validator";

enum NodeEnv {
  Development = "development",
  Production = "production",
  Test = "test",
}

enum AppEnv {
  Dev = "dev",
  Staging = "staging",
  Sandbox = "sandbox",
  Prod = "prod",
}

class EnvVars {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

  /**
   * Encoded into every payment reference this deployment mints. Determines
   * which environment "owns" a webhook when the same provider callback is
   * shared across dev/staging/prod. See payment-reference.ts.
   */
  @IsEnum(AppEnv)
  @IsOptional()
  APP_ENV: AppEnv = AppEnv.Dev;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  PORT: number = 4000;

  // ── Supabase ──
  @IsString()
  SUPABASE_URL!: string;

  @IsString()
  SUPABASE_ANON_KEY!: string;

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY!: string;

  /** HS256 secret from Supabase → Project Settings → API → JWT Settings. */
  @IsString()
  SUPABASE_JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  SUPABASE_EMAIL_HOOK_SECRET?: string;

  /**
   * Postgres connection string for the Supabase project. Local:
   *   postgres://postgres:<pw>@localhost:54322/postgres
   * Cloud (direct):
   *   postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
   * Cloud (pooled — Supavisor):
   *   postgres://postgres.<ref>:<pw>@<region>.pooler.supabase.com:6543/postgres
   */
  @IsString()
  SUPABASE_DB_URL!: string;

  // ── Monnify ──
  @IsString()
  MONNIFY_BASE_URL!: string;

  @IsString()
  MONNIFY_API_KEY!: string;

  @IsString()
  MONNIFY_SECRET_KEY!: string;

  @IsString()
  MONNIFY_CONTRACT_CODE!: string;

  @IsString()
  MONNIFY_WEBHOOK_SECRET!: string;

  /**
   * Linked disbursement wallet account number that funds outbound transfers
   * (refunds, host payouts). Sandbox provisions one automatically once
   * "Wallet as Source" is enabled; prod uses the merchant's operations wallet.
   */
  @IsString()
  @IsOptional()
  MONNIFY_DISBURSEMENT_WALLET?: string;

  /**
   * Restricts reserved-account provisioning to a single partner bank code
   * (e.g. Moniepoint MFB). Optional — unset requests every partner bank
   * Monnify supports.
   */
  @IsString()
  @IsOptional()
  MONNIFY_RESERVED_ACCOUNT_BANK_CODE?: string;

  // ── Platform ──
  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  PLATFORM_FEE_BPS: number = 250;

  // ── SMTP (Mailhog defaults) ──
  @IsString()
  @IsOptional()
  SMTP_HOST: string = "localhost";

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  SMTP_PORT: number = 1025;

  @IsString()
  @IsOptional()
  SMTP_USER: string = "";

  @IsString()
  @IsOptional()
  SMTP_PASS: string = "";

  @IsString()
  @IsOptional()
  SMTP_SECURE: string = "false";

  @IsString()
  @IsOptional()
  EMAIL_FROM_ADDRESS: string = "no-reply@bookmi.co";

  @IsString()
  @IsOptional()
  EMAIL_FROM_NAME: string = "Bookmi";

  // ── Redis (BullMQ) ──
  @IsString()
  @IsOptional()
  REDIS_HOST: string = "localhost";

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  REDIS_PORT: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD: string = "";

  @IsInt()
  @Min(0)
  @Max(15)
  @IsOptional()
  REDIS_QUEUE_DB: number = 1;

  // ── Bull Board admin UI (optional basic auth) ──
  @IsString()
  @IsOptional()
  BULL_BOARD_USER: string = "";

  @IsString()
  @IsOptional()
  BULL_BOARD_PASS: string = "";

  // ── Frontend URL — used to build OTP + booking-confirmed links inside emails ──
  @IsString()
  @IsOptional()
  WEB_BASE_URL: string = "http://localhost:5173";

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    return value
      .split(",")
      .map((v: string) => v.trim())
      .filter((v: string) => v.length > 0);
  })
  CORS_ORIGINS: string[] = [];
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const parsed = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(", ")}`)
        .join("\n")}`,
    );
  }
  return parsed;
}
