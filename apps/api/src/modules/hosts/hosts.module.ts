import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HostProfileController } from "./controllers/host-profile.controller";
import { HostServicesController } from "./controllers/host-services.controller";
import { HostBookingsController } from "./controllers/host-bookings.controller";
import { HostWalletController } from "./controllers/host-wallet.controller";
import { HostCustomersController } from "./controllers/host-customers.controller";
import { HostLedgerController } from "./controllers/host-ledger.controller";
import { PaycodeController } from "./controllers/paycode.controller";
import { HostProfileService } from "./services/host-profile.service";
import { HostServicesService } from "./services/host-services.service";
import { HostBookingsService } from "./services/host-bookings.service";
import { HostWalletService } from "./services/host-wallet.service";
import { CustomersService } from "./services/customers.service";
import { PaycodeService } from "./services/paycode.service";
import { PaymentsModule } from "../payments/payments.module";
import { SecurityModule } from "../security/security.module";
import { WalletLedgerModule } from "./wallet-ledger.module";
import { QUEUE_PAYCODE_SWEEP } from "../../common/queues/queue.constants";

@Module({
  // PaymentsModule exports PaymentProviderRegistry — HostWalletService uses it
  // for bank listing + account verification through the same Monnify adapter
  // the checkout uses.
  // SecurityModule exports SecurityService — the refund + withdraw services
  // call verifyAndConsume before touching money.
  // BullModule.registerQueue makes the paycode-sweep queue injectable in
  // this module (producers side). The matching processor + scheduler live in
  // workers.module.ts so they only run in the APP_ROLE=worker container.
  imports: [
    PaymentsModule,
    SecurityModule,
    WalletLedgerModule,
    BullModule.registerQueue({ name: QUEUE_PAYCODE_SWEEP }),
  ],
  controllers: [
    HostProfileController,
    HostServicesController,
    HostBookingsController,
    HostWalletController,
    HostCustomersController,
    HostLedgerController,
    PaycodeController,
  ],
  providers: [
    HostProfileService,
    HostServicesService,
    HostBookingsService,
    HostWalletService,
    CustomersService,
    PaycodeService,
  ],
  exports: [
    HostProfileService,
    HostServicesService,
    HostBookingsService,
    HostWalletService,
    CustomersService,
    PaycodeService,
  ],
})
export class HostsModule {}
