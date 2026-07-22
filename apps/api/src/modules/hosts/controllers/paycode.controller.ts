import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { CreatePaycodeDto, CreatePaycodeSchema } from "../dto/hosts.dto";
import { PaycodeService } from "../services/paycode.service";

@ApiTags("hosts")
@ApiBearerAuth()
@Controller({ path: "hosts/me/wallet/paycodes" })
export class PaycodeController {
  constructor(private readonly paycodes: PaycodeService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Generate a paycode redeemable for cash at a Moniepoint POS agent. Requires x-idempotency-key + x-otp-code headers.",
  })
  async create(
    @Body(new ZodValidationPipe(CreatePaycodeSchema)) body: CreatePaycodeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-otp-code") otpCode: string | undefined,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw new BadRequestException("x-idempotency-key header required (8-100 chars).");
    }
    if (!otpCode || !/^\d{6}$/.test(otpCode)) {
      throw new BadRequestException("x-otp-code header required (6 digits).");
    }

    const result = await this.paycodes.createPaycode(user.sub, {
      amountKobo: body.amountKobo,
      idempotencyKey,
      otpCode,
    });
    return { paycode: result.paycode, cached: result.cached };
  }

  @Get()
  @ApiOperation({ summary: "List this host's paycodes, newest first." })
  async list(@CurrentUser() user: AuthenticatedUser) {
    const items = await this.paycodes.listPaycodes(user.sub);
    return { items };
  }

  @Get(":id")
  @ApiOperation({ summary: "Masked detail for one paycode." })
  async get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    const paycode = await this.paycodes.getPaycode(user.sub, id);
    return { paycode };
  }

  @Get(":id/reveal")
  @ApiOperation({
    summary:
      "Get the unmasked, redeemable code. Requires x-otp-code header — a second re-auth beyond the one that gated creation, since anyone who sees this can walk into an agent and cash it.",
  })
  async reveal(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-otp-code") otpCode: string | undefined,
  ) {
    if (!otpCode || !/^\d{6}$/.test(otpCode)) {
      throw new BadRequestException("x-otp-code header required (6 digits).");
    }
    return this.paycodes.revealPaycode(user.sub, id, otpCode);
  }

  @Delete(":id")
  @ApiOperation({
    summary:
      "Cancel a pending paycode and credit the hold back to the wallet. No OTP needed — cancelling only returns money to the host's own balance.",
  })
  async cancel(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    const paycode = await this.paycodes.cancelPaycode(user.sub, id);
    return { paycode };
  }
}
