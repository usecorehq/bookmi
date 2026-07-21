import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import {
  ActivateReservedAccountDto,
  ActivateReservedAccountSchema,
  SavePayoutAccountDto,
  SavePayoutAccountSchema,
  VerifyBankAccountDto,
  VerifyBankAccountSchema,
  WithdrawDto,
  WithdrawSchema,
} from "../dto/hosts.dto";
import { HostWalletService } from "../services/host-wallet.service";

@ApiTags("hosts")
@ApiBearerAuth()
@Controller({ path: "hosts/me/wallet" })
export class HostWalletController {
  constructor(private readonly wallet: HostWalletService) { }

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

  @Post("withdraw")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Withdraw funds to the saved payout account. Requires x-idempotency-key + x-otp-code headers. Destination bank comes from the host's saved account — never the request body — so a compromised session can't swap the destination.",
  })
  async withdraw(
    @Body(new ZodValidationPipe(WithdrawSchema)) body: WithdrawDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-otp-code") otpCode: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw new BadRequestException(
        "x-idempotency-key header required (8-100 chars).",
      );
    }
    if (!otpCode || !/^\d{6}$/.test(otpCode)) {
      throw new BadRequestException(
        "x-otp-code header required (6 digits).",
      );
    }

    const result = await this.wallet.withdraw(user.sub, {
      amountKobo: body.amountKobo,
      idempotencyKey,
      otpCode,
    });

    if (result.cached && result.payout.status === "failed") {
      throw new BadRequestException(
        result.payout.failureReason ?? "Withdrawal previously failed.",
      );
    }
    if (result.cached && result.payout.status === "processing") {
      res.status(HttpStatus.ACCEPTED);
    }
    return { payout: result.payout };
  }

  @Post("activate-reserved-account")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Activate a reserved bank account for direct transfers into the wallet. Collects BVN. Calls the real Monnify reserved-account API when MONNIFY_USE_RESERVED_ACCOUNT_API is on, otherwise falls back to a mocked account number. Idempotent — returns the existing wallet if already activated.",
  })
  async activateReservedAccount(
    @Body(new ZodValidationPipe(ActivateReservedAccountSchema))
    body: ActivateReservedAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const wallet = await this.wallet.activateReservedAccount(user.sub, body.bvn, user.email);
    return { wallet };
  }
}
