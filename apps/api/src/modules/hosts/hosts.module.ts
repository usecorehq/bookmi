import { Module } from "@nestjs/common";
import { HostProfileController } from "./controllers/host-profile.controller";
import { HostServicesController } from "./controllers/host-services.controller";
import { HostBookingsController } from "./controllers/host-bookings.controller";
import { HostWalletController } from "./controllers/host-wallet.controller";
import { HostCustomersController } from "./controllers/host-customers.controller";
import { HostProfileService } from "./services/host-profile.service";
import { HostServicesService } from "./services/host-services.service";
import { HostBookingsService } from "./services/host-bookings.service";
import { HostWalletService } from "./services/host-wallet.service";
import { CustomersService } from "./services/customers.service";
import { PaymentsModule } from "../payments/payments.module";

@Module({
  // PaymentsModule exports PaymentProviderRegistry — HostWalletService uses it
  // for bank listing + account verification through the same Monnify adapter
  // the checkout uses.
  imports: [PaymentsModule],
  controllers: [
    HostProfileController,
    HostServicesController,
    HostBookingsController,
    HostWalletController,
    HostCustomersController,
  ],
  providers: [
    HostProfileService,
    HostServicesService,
    HostBookingsService,
    HostWalletService,
    CustomersService,
  ],
  exports: [
    HostProfileService,
    HostServicesService,
    HostBookingsService,
    HostWalletService,
    CustomersService,
  ],
})
export class HostsModule {}
