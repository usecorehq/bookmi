import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { buildSupabaseDb, type SupabaseDb } from "./client";

export const SUPABASE_DB = Symbol("SUPABASE_DB");
export type { SupabaseDb };

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_DB,
      useFactory: (config: ConfigService): SupabaseDb => {
        const url = config.getOrThrow<string>("supabase.dbUrl");
        return buildSupabaseDb(url);
      },
      inject: [ConfigService],
    },
  ],
  exports: [SUPABASE_DB],
})
export class DrizzleModule {}
