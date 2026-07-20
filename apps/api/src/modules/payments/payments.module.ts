import { Module } from "@nestjs/common";
import { PaymentsController } from "./controllers/payments.controller";
import { PaymentsWebhookController } from "./controllers/payments-webhook.controller";
import { PaymentsService } from "./services/payments.service";
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

    // Orchestrator
    PaymentsService,
  ],
  exports: [PaymentsService, PaymentProviderRegistry],
})
export class PaymentsModule {}
