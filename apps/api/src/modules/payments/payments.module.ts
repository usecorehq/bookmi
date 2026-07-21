import { Module } from "@nestjs/common";
import { PaymentsController } from "./controllers/payments.controller";
import { PaymentsWebhookController } from "./controllers/payments-webhook.controller";
import { PaymentsService } from "./services/payments.service";
import { RefundWebhookService } from "./services/refund-webhook.service";
import { ReservedAccountWebhookService } from "./services/reserved-account-webhook.service";
import { PaymentProviderRegistry } from "./providers/payment-provider.registry";
import { PAYMENT_PROVIDERS } from "./providers/payment-provider.interface";
import { MonnifyProvider } from "./providers/monnify.provider";
import { PurposeHandlerRegistry } from "./purposes/purpose-handler.registry";
import { PAYMENT_PURPOSE_HANDLERS } from "./purposes/purpose-handler.interface";
import { BookingCheckoutHandler } from "./purposes/booking-checkout.handler";
import { WalletLedgerModule } from "../hosts/wallet-ledger.module";

@Module({
  imports: [WalletLedgerModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [
    // Provider adapters — only Monnify today. Paystack/Flutterwave slot in
    // here later without touching the orchestrator.
    MonnifyProvider,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (monnify: MonnifyProvider) => [monnify],
      inject: [MonnifyProvider],
    },
    PaymentProviderRegistry,

    // Purpose handlers — bookmi has one.
    BookingCheckoutHandler,
    {
      provide: PAYMENT_PURPOSE_HANDLERS,
      useFactory: (booking: BookingCheckoutHandler) => [booking],
      inject: [BookingCheckoutHandler],
    },
    PurposeHandlerRegistry,

    // Refund-webhook reconciliation — reconciles SUCCESSFUL_REFUND/
    // FAILED_REFUND against `refunds` + `wallet_ledger`. Only exercised once
    // `MONNIFY_USE_REFUND_API` is flipped on (see `HostBookingsService`).
    RefundWebhookService,

    // Reserved-account-webhook reconciliation — reconciles
    // RESERVED_ACCOUNT_TRANSACTION against `wallet_ledger`. Only exercised
    // once `MONNIFY_USE_RESERVED_ACCOUNT_API` is flipped on (see
    // `HostWalletService.activateReservedAccount`).
    ReservedAccountWebhookService,

    // Orchestrator
    PaymentsService,
  ],
  exports: [PaymentsService, PaymentProviderRegistry],
})
export class PaymentsModule {}
