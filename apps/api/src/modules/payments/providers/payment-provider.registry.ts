import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { countryPaymentProviders, paymentProviders } from "../../../drizzle/schema";
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type PaymentProviderCode,
} from "./payment-provider.interface";

/**
 * Provider lookup:
 *  - `get(code)` — direct lookup by provider code (webhook URL → provider).
 *  - `resolveForCountry(countryCode)` — picks the highest-priority (lowest
 *    integer) active provider configured for that country. Falls back through
 *    the priority list if the primary is inactive.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byCode: Map<PaymentProviderCode, PaymentProvider>;

  constructor(
    @Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[],
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
  ) {
    this.byCode = new Map(providers.map((p) => [p.code, p]));
  }

  get(code: PaymentProviderCode): PaymentProvider {
    const provider = this.byCode.get(code);
    if (!provider) throw new NotFoundException(`Unknown payment provider: ${code}`);
    return provider;
  }

  has(code: PaymentProviderCode): boolean {
    return this.byCode.has(code);
  }

  async resolveForCountry(countryCode: string): Promise<PaymentProvider> {
    const rows = await this.db
      .select({ providerCode: countryPaymentProviders.providerCode })
      .from(countryPaymentProviders)
      .innerJoin(
        paymentProviders,
        eq(paymentProviders.code, countryPaymentProviders.providerCode),
      )
      .where(
        and(
          eq(countryPaymentProviders.countryCode, countryCode),
          eq(countryPaymentProviders.isActive, true),
          eq(paymentProviders.isActive, true),
        ),
      )
      .orderBy(asc(countryPaymentProviders.priority));

    for (const row of rows) {
      const provider = this.byCode.get(row.providerCode);
      if (provider) return provider;
    }
    throw new ServiceUnavailableException(
      `No active payment provider configured for country ${countryCode}`,
    );
  }
}
