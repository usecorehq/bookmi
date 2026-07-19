import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/current-user.decorator";

/**
 * Auth-adjacent endpoints. There is no login/logout/refresh here — Supabase
 * itself is the token issuer (frontend calls supabase.auth.signInWithPassword,
 * gets an access_token, sends it as `Authorization: Bearer <jwt>` on every
 * request). This controller only exposes what the backend can see about the
 * currently authenticated caller — useful for verifying the token flow works
 * end-to-end.
 */
@ApiTags("auth")
@ApiBearerAuth()
@Controller({ path: "auth" })
export class AuthController {
  @Get("me")
  @ApiOperation({
    summary:
      "Return the verified JWT payload for the calling user. If Swagger shows 401 here, either your token is stale, or the audience/algorithm doesn't match.",
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }
}
