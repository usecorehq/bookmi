import { plainToInstance } from "class-transformer";
import {
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

class EnvVars {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

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

  @IsString()
  DATABASE_URL!: string;

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

  // ── Platform ──
  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  PLATFORM_FEE_BPS: number = 250;
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
