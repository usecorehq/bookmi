import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * The verified Supabase JWT payload, minus provider noise.
 * `sub` is the Supabase user id — join key against `host_profiles.user_id`.
 */
export interface AuthenticatedUser {
  sub: string;
  email?: string;
  role?: string;
  aud?: string;
  session_id?: string;
  [key: string]: unknown;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    return req.user;
  },
);
