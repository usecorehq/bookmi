import { Module } from "@nestjs/common";
import { PublicHostController } from "./controllers/public-host.controller";
import { PublicCheckoutController } from "./controllers/public-checkout.controller";
import { PublicHostService } from "./services/public-host.service";
import { PublicCheckoutService } from "./services/public-checkout.service";
import { PaymentsModule } from "../payments/payments.module";
import { HostsModule } from "../hosts/hosts.module";

/**
 * Anonymous surface: `GET /public/:slug`, `GET /public/:slug/:serviceSlug`,
 * `POST /public/:slug/:serviceSlug/checkout`. All routes marked @Public so the
 * global auth guard skips them.
 *
 *   - PaymentsModule → PaymentsService.initiate for the checkout intent.
 *     Pricing + settlement stay owned by BookingCheckoutHandler.
 *   - HostsModule → CustomersService.resolveOrCreate to link every storefront
 *     booking to a durable customer row.
 */
@Module({
  imports: [PaymentsModule, HostsModule],
  controllers: [PublicHostController, PublicCheckoutController],
  providers: [PublicHostService, PublicCheckoutService],
})
export class PublicModule {}
