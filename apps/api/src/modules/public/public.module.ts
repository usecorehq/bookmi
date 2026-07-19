import { Module } from "@nestjs/common";
import { PublicHostController } from "./controllers/public-host.controller";
import { PublicCheckoutController } from "./controllers/public-checkout.controller";
import { PublicHostService } from "./services/public-host.service";
import { PublicCheckoutService } from "./services/public-checkout.service";
import { PaymentsModule } from "../payments/payments.module";

/**
 * Anonymous surface: `GET /public/:slug`, `GET /public/:slug/:serviceSlug`,
 * `POST /public/:slug/:serviceSlug/checkout`. All routes marked @Public so the
 * global auth guard skips them. Depends on PaymentsModule for the checkout
 * initiate call — pricing + settlement stay owned by the BookingCheckoutHandler.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [PublicHostController, PublicCheckoutController],
  providers: [PublicHostService, PublicCheckoutService],
})
export class PublicModule {}
