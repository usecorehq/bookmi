import { Controller, Get, HttpCode, HttpStatus, Post, RawBodyRequest, Req, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/current-user.decorator";
import { Public } from "@/common/decorators/public.decorator";
import { verifyWebhookSignature } from "./helpers/signature.helper";
import { EmailsService } from "../emails/emails.service";
import { ConfigService } from "@nestjs/config";

/**
 * Auth-adjacent endpoints. There is no login/logout/refresh here — Supabase
 * itself is the token issuer (frontend calls supabase.auth.signInWithPassword,
 * gets an access_token, sends it as `Authorization: Bearer <jwt>` on every
 * request). This controller only exposes what the backend can see about the
 * currently authenticated caller — useful for verifying the token flow works
 * end-to-end.
 */
@ApiTags("auth")
@Controller({ path: "auth" })
export class AuthController {
  constructor(
    private readonly emails: EmailsService,
    private readonly config: ConfigService,
  ) { }

  @Get("me")
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Return the verified JWT payload for the calling user. If Swagger shows 401 here, either your token is stale, or the audience/algorithm doesn't match.",
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }

  @Public()
  @Post("email-hook")
  @HttpCode(HttpStatus.OK)
  async handleEmailWebhook(@Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) {
      throw new UnauthorizedException("Missing raw body");
    }
    const secret = this.config.get<string>("supabase.emailHookSecret");
    if (!secret) {
      throw new UnauthorizedException("Webhook secret not configured");
    }
    const isValid = verifyWebhookSignature(req.rawBody, req.headers, secret);
    if (!isValid) {
      throw new UnauthorizedException("Invalid signature verification");
    }
    const payload = JSON.parse(req.rawBody.toString("utf8"));
    const { user, email_data } = payload;
    const { email_action_type, token, token_hash, redirect_to, site_url } = email_data;

    // We deliberately do NOT link to Supabase's `/auth/v1/verify` endpoint.
    // The SPA is a PKCE client — GoTrue's verify redirect returns without a
    // `?code=` parameter, which the SPA's AuthCallback treats as a failure.
    // Instead we hand the user a link to bookmi's own OTP page, pre-filled
    // with the 6-digit token. VerifyOtpPage calls supabase.auth.verifyOtp()
    // which is PKCE-compatible. `site_url`/`redirect_to` are ignored on
    // purpose — bookmi's WEB_BASE_URL is the source of truth.
    const webBase = this.config.getOrThrow<string>("web.baseUrl").replace(/\/+$/, "");
    // Kept for future forwarding logic — mark as used so lint stays quiet.
    void site_url;
    void redirect_to;

    if (email_action_type === "signup") {
      const verifyUrl = `${webBase}/auth/verify-otp?flow=signup&email=${encodeURIComponent(user.email)}&code=${token}`;
      await this.emails.send({
        kind: "confirm_email",
        to: user.email,
        data: {
          email: user.email,
          code: token,
          verifyUrl,
        },
      });
    } else if (email_action_type === "recovery") {
      const verifyUrl = `${webBase}/auth/verify-otp?flow=recovery&email=${encodeURIComponent(user.email)}&code=${token}`;
      await this.emails.send({
        kind: "reset_password",
        to: user.email,
        data: {
          email: user.email,
          code: token,
          verifyUrl,
        },
      });
    }
    return { success: true };
  }
}
