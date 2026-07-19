import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { generateKeyPairSync } from "node:crypto";
import * as jwt from "jsonwebtoken";
import { SupabaseJwtGuard } from "./supabase-jwt.guard";

const SECRET = "test-secret-at-least-16-chars";
const USER_ID = "7b6a2a70-6c8f-4b4e-9c39-2f1c2f9f6a11";

function makeGuard(config: Record<string, string | undefined> = {}, isPublic = false) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  const configService = {
    get: (key: string) =>
      ({ "supabase.jwtSecret": SECRET, ...config })[key as keyof typeof config],
  } as unknown as ConfigService;
  return new SupabaseJwtGuard(reflector, configService);
}

function makeContext(headers: Record<string, string> = {}) {
  const req: { headers: Record<string, string>; user?: unknown } = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("SupabaseJwtGuard", () => {
  describe("request shape", () => {
    it("lets @Public routes through without a token", async () => {
      const guard = makeGuard({}, true);
      const { ctx } = makeContext();
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it("rejects a missing Authorization header", async () => {
      const guard = makeGuard();
      const { ctx } = makeContext();
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a non-bearer Authorization header", async () => {
      const guard = makeGuard();
      const { ctx } = makeContext({ authorization: "Basic abc" });
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("HS256 (shared secret)", () => {
    const sign = (payload: object, opts: jwt.SignOptions = {}) =>
      jwt.sign(payload, SECRET, { algorithm: "HS256", expiresIn: 3600, ...opts });

    it("accepts a valid user token and maps claims onto req.user", async () => {
      const guard = makeGuard();
      const token = sign(
        { sub: USER_ID, email: "a@b.co", role: "authenticated", session_id: "sess-1" },
        { audience: "authenticated" },
      );
      const { ctx, req } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.user).toMatchObject({
        sub: USER_ID,
        email: "a@b.co",
        role: "authenticated",
        aud: "authenticated",
        session_id: "sess-1",
      });
    });

    it("rejects a token signed with a different secret", async () => {
      const guard = makeGuard();
      const token = jwt.sign({ sub: USER_ID }, "another-secret-16-chars", {
        algorithm: "HS256",
        audience: "authenticated",
        expiresIn: 3600,
      });
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects an expired token", async () => {
      const guard = makeGuard();
      const token = sign({ sub: USER_ID }, { audience: "authenticated", expiresIn: -10 });
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a legacy anon API key (no aud, no sub)", async () => {
      const guard = makeGuard();
      // Shape of Supabase's legacy anon key payload — same signing secret.
      const token = sign({ iss: "supabase", ref: "abcdefgh", role: "anon" });
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a valid-audience token without a sub", async () => {
      const guard = makeGuard();
      const token = sign({ role: "authenticated" }, { audience: "authenticated" });
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow("Token missing sub");
    });

    it("rejects service_role even when crafted with the right audience", async () => {
      const guard = makeGuard();
      const token = sign(
        { sub: USER_ID, role: "service_role" },
        { audience: "authenticated" },
      );
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects when the secret is not configured", async () => {
      const guard = makeGuard({ "supabase.jwtSecret": undefined });
      const token = sign({ sub: USER_ID }, { audience: "authenticated" });
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("ES256 (JWKS)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const signEs256 = (payload: object, opts: jwt.SignOptions = {}) =>
      jwt.sign(payload, privatePem, {
        algorithm: "ES256",
        keyid: "key-1",
        expiresIn: 3600,
        ...opts,
      });

    function withJwks(guard: SupabaseJwtGuard, pem: string) {
      (guard as unknown as { jwksClient: unknown }).jwksClient = {
        getSigningKey: jest.fn().mockResolvedValue({ getPublicKey: () => pem }),
      };
      return guard;
    }

    it("accepts a valid asymmetric token via the JWKS key", async () => {
      const guard = withJwks(makeGuard(), publicPem);
      const token = signEs256(
        { sub: USER_ID, role: "authenticated" },
        { audience: "authenticated" },
      );
      const { ctx, req } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.user).toMatchObject({ sub: USER_ID });
    });

    it("rejects an asymmetric token whose audience is not authenticated", async () => {
      const guard = withJwks(makeGuard(), publicPem);
      const token = signEs256({ sub: USER_ID }, { audience: "something-else" });
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects an asymmetric token signed by a different key", async () => {
      const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const guard = withJwks(makeGuard(), publicPem);
      const token = jwt.sign(
        { sub: USER_ID },
        other.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        { algorithm: "ES256", keyid: "key-1", audience: "authenticated", expiresIn: 3600 },
      );
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects asymmetric tokens when SUPABASE_URL is not configured", async () => {
      const guard = makeGuard({ "supabase.url": undefined });
      const token = signEs256({ sub: USER_ID }, { audience: "authenticated" });
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("algorithm pinning", () => {
    it("rejects alg=none tokens outright", async () => {
      const guard = makeGuard();
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({
        sub: USER_ID,
        aud: "authenticated",
      })}.`;
      const { ctx } = makeContext(bearer(token));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects garbage that does not decode as a JWT", async () => {
      const guard = makeGuard();
      const { ctx } = makeContext(bearer("not-a-jwt"));
      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });
});
