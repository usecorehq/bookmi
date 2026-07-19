import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { RequestOtpDto, RequestOtpSchema } from "./security.dto";
import { SecurityService } from "./security.service";

@ApiTags("security")
@ApiBearerAuth()
@Controller({ path: "hosts/me/security" })
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Post("otp/challenge")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Mint a fresh 6-digit OTP for a money-out purpose (refund or withdraw). Emails the code; response carries only the challenge id + expiry — never the code.",
  })
  async requestOtp(
    @Body(new ZodValidationPipe(RequestOtpSchema)) body: RequestOtpDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.security.requestOtp(user.sub, body.purpose);
  }
}
