import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import {
  SavePayoutAccountDto,
  SavePayoutAccountSchema,
  VerifyBankAccountDto,
  VerifyBankAccountSchema,
} from "../dto/hosts.dto";
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

  @Get("banks")
  @ApiOperation({
    summary: "Bank list for the payout dropdown. Cached 24h in-process.",
  })
  async listBanks(@CurrentUser() _user: AuthenticatedUser) {
    // Auth just gates access to the endpoint — the list itself is not
    // user-specific.
    const items = await this.wallet.listBanks();
    return { items };
  }

  @Post("verify-bank-account")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Resolve the account holder's name for (bankCode, accountNumber). Not persisted.",
  })
  async verifyBankAccount(
    @Body(new ZodValidationPipe(VerifyBankAccountSchema)) body: VerifyBankAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.wallet.verifyBankAccount(user.sub, body.bankCode, body.accountNumber);
  }

  @Post("payout-account")
  @ApiOperation({
    summary: "Save the payout destination. Server re-verifies and rejects a name mismatch.",
  })
  async savePayoutAccount(
    @Body(new ZodValidationPipe(SavePayoutAccountSchema)) body: SavePayoutAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const wallet = await this.wallet.savePayoutAccount(user.sub, body);
    return { wallet };
  }
}
