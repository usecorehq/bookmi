import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import * as jwt from "jsonwebtoken";
import { TestAppModule, TEST_JWT_SECRET } from "./test-app.module";

const USER_ID = "11111111-1111-1111-1111-111111111111";

/** Mints a token shaped like a real Supabase user access token. */
function signTestToken(overrides: Partial<jwt.JwtPayload> = {}) {
  return jwt.sign(
    { sub: USER_ID, role: "authenticated", ...overrides },
    TEST_JWT_SECRET,
    { algorithm: "HS256", audience: "authenticated", expiresIn: 3600 },
  );
}

describe("App (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = mod.createNestApplication({ logger: false, rawBody: true });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("public endpoints", () => {
    it("GET /api/health returns 200 without a token", async () => {
      await request(app.getHttpServer())
        .get("/api/health")
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({ status: "ok", service: "bookmi-api" });
        });
    });

    it("POST /api/payments/webhook/:provider is public (no auth, but 400 without signature)", async () => {
      // Public route runs; then MonnifyProvider rejects the missing signature.
      await request(app.getHttpServer())
        .post("/api/payments/webhook/monnify")
        .send({ eventType: "SUCCESSFUL_TRANSACTION" })
        .expect(400);
    });
  });

  describe("guarded endpoints", () => {
    it("GET /api/auth/me returns 401 without a token", async () => {
      await request(app.getHttpServer()).get("/api/auth/me").expect(401);
    });

    it("GET /api/auth/me returns the mapped claims with a valid token", async () => {
      await request(app.getHttpServer())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${signTestToken({ email: "ada@bookmi.co" })}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.user).toMatchObject({
            sub: USER_ID,
            email: "ada@bookmi.co",
            aud: "authenticated",
          });
        });
    });

    it("POST /api/payments/initiate returns 401 without a token", async () => {
      await request(app.getHttpServer()).post("/api/payments/initiate").send({}).expect(401);
    });

    it("POST /api/payments/initiate rejects an invalid body with 400", async () => {
      await request(app.getHttpServer())
        .post("/api/payments/initiate")
        .set("Authorization", `Bearer ${signTestToken()}`)
        .send({ purposeType: "not-a-real-purpose", amountMinor: -5 })
        .expect(400);
    });

    it("POST /api/payments/initiate rejects unknown extra fields (whitelist)", async () => {
      await request(app.getHttpServer())
        .post("/api/payments/initiate")
        .set("Authorization", `Bearer ${signTestToken()}`)
        .send({
          purposeType: "booking_checkout",
          amountMinor: 250_000,
          email: "buyer@example.com",
          smugglingExtra: "🙈",
        })
        .expect(400);
    });
  });
});
