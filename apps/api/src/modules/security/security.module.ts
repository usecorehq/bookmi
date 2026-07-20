import { Module } from "@nestjs/common";
import { SecurityController } from "./security.controller";
import { SecurityService } from "./security.service";

/**
 * Second-factor OTP gate for money-out operations. `SecurityService` is
 * exported so refund + payout callsites can invoke `verifyAndConsume`
 * inline without going through HTTP.
 *
 * EmailsModule is @Global, so `EmailsService` is discovered without an
 * explicit import here.
 */
@Module({
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
