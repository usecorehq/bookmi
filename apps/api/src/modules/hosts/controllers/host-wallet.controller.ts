import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { HostWalletService } from "../services/host-wallet.service";

@ApiTags("hosts")
@ApiBearerAuth()
@Controller({ path: "hosts/me/wallet" })
export class HostWalletController {
  constructor(private readonly wallet: HostWalletService) {}

  @Get()
  @ApiOperation({
    summary: "Wallet snapshot — balance (kobo), reserved account details, recent bookings + payouts.",
  })
  async get(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.get(user.sub);
  }
}
