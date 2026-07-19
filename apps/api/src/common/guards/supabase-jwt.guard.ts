import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import * as jwt from "jsonwebtoken";
import JwksRsa from "jwks-rsa";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { AuthenticatedUser } from "../decorators/current-user.decorator";

/**
 * Verifies Supabase-issued access tokens.
 *
 * Dual-mode by token header `alg`, with the algorithm family pinned per key
 * source so neither mode can be confused into the other:
 *  - HS256 → the project's legacy shared JWT secret (SUPABASE_JWT_SECRET)
 *  - ES256/RS256 → the project's JWKS (derived from SUPABASE_URL), for when
 *    the Supabase project migrates to asymmetric signing keys
 *
 * `audience: 'authenticated'` is enforced on both paths: the legacy anon and
 * service-role API keys are JWTs signed with the same shared secret but carry
 * no `aud`/`sub`, so they must never authenticate as a user.
 */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseJwtGuard.name);
  private jwksClient?: JwksRsa.JwksClient;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();
    const auth = req.headers["authorization"] ?? req.headers["Authorization"];
    if (!auth || !auth.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = auth.slice("Bearer ".length).trim();

    const payload = await this.verifyToken(token);

    // Belt and braces on top of the audience check — API-key roles are never
    // request principals.
    if (payload.role === "anon" || payload.role === "service_role") {
      throw new UnauthorizedException("Invalid token");
    }
    if (!payload.sub) throw new UnauthorizedException("Token missing sub");

    req.user = {
      sub: String(payload.sub),
      email: payload.email as string | undefined,
      role: payload.role as string | undefined,
      aud: typeof payload.aud === "string" ? payload.aud : undefined,
      session_id: payload.session_id as string | undefined,
    };
    return true;
  }

  private async verifyToken(token: string): Promise<jwt.JwtPayload> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) throw new UnauthorizedException("Invalid token");
    const { alg, kid } = decoded.header;

    try {
      if (alg === "HS256") {
        const secret = this.config.get<string>("supabase.jwtSecret");
        if (!secret) {
          this.logger.error("SUPABASE_JWT_SECRET not configured");
          throw new UnauthorizedException();
        }
        return jwt.verify(token, secret, {
          algorithms: ["HS256"],
          audience: "authenticated",
        }) as jwt.JwtPayload;
      }

      if (alg === "ES256" || alg === "RS256") {
        const key = await this.getJwksKey(kid);
        return jwt.verify(token, key, {
          algorithms: ["ES256", "RS256"],
          audience: "authenticated",
        }) as jwt.JwtPayload;
      }

      // Anything else ('none' included) is not a Supabase user token.
      throw new UnauthorizedException("Invalid token");
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.debug(`JWT verification failed (${alg}): ${(err as Error).message}`);
      throw new UnauthorizedException("Invalid token");
    }
  }

  private async getJwksKey(kid: string | undefined): Promise<string> {
    if (!this.jwksClient) {
      const supabaseUrl = this.config.get<string>("supabase.url");
      if (!supabaseUrl) {
        this.logger.error(
          "Received an asymmetrically-signed token but SUPABASE_URL is not configured — cannot resolve JWKS",
        );
        throw new UnauthorizedException("Invalid token");
      }
      this.jwksClient = new JwksRsa.JwksClient({
        jwksUri: `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`,
        cache: true,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        timeout: 5_000,
      });
    }
    const key = await this.jwksClient.getSigningKey(kid);
    return key.getPublicKey();
  }
}
