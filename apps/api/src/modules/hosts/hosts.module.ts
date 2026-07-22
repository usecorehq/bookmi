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
import { PaycodeSweepProcessor } from "./services/paycode-sweep.processor";
import { PaycodeSweepScheduler } from "./services/paycode-sweep.scheduler";
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
  // BullModule.registerQueue wires the 5-minute paycode expiry sweep onto
  // the Redis connection QueuesModule already provides globally.
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
    PaycodeSweepProcessor,
    PaycodeSweepScheduler,
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
