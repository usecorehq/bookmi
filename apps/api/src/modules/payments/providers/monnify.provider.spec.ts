import { createHmac } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import { MonnifyProvider } from "./monnify.provider";

const API_KEY = "MK_TEST_KEY";
const SECRET = "sk_test_monnify";
const CONTRACT_CODE = "626609763141";

function fakeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    "monnify.apiKey": API_KEY,
    "monnify.secretKey": SECRET,
    "monnify.contractCode": CONTRACT_CODE,
    "monnify.baseUrl": "https://monnify.test",
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] == null) throw new Error(`missing config ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

function mockAuthLogin(fetchMock: jest.Mock, token = "AT_1", expiresIn = 3300) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      requestSuccessful: true,
      responseBody: { accessToken: token, expiresIn },
    }),
  });
}

describe("MonnifyProvider", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  describe("initialize (popup flow)", () => {
    it("echoes our reference back without any HTTP call", async () => {
      const provider = new MonnifyProvider(fakeConfig());
      const result = await provider.initialize({
        reference: "dev-bookmi_pmt_xyz",
        amountMinor: 250_000,
        currency: "NGN",
        email: "buyer@example.com",
      });
      expect(result.providerReference).toBe("dev-bookmi_pmt_xyz");
      expect(result.authorizationUrl).toBeUndefined();
      expect(result.accessCode).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats an explicit metadata.checkout_mode="popup" the same as the default', async () => {
      const provider = new MonnifyProvider(fakeConfig());
      const result = await provider.initialize({
        reference: "dev-bookmi_pmt_xyz",
        amountMinor: 250_000,
        currency: "NGN",
        email: "buyer@example.com",
        metadata: { checkout_mode: "popup" },
      });
      expect(result.providerReference).toBe("dev-bookmi_pmt_xyz");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("initialize (hosted flow)", () => {
    it("calls init-transaction and returns Monnify checkoutUrl as authorizationUrl", async () => {
      mockAuthLogin(fetchMock);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requestSuccessful: true,
          responseBody: {
            transactionReference: "MNFY|20|MER|abc",
            paymentReference: "dev-bookmi_pmt_xyz",
            merchantName: "Bookmi Test",
            checkoutUrl:
              "https://sandbox.sdk.monnify.com/checkout?transactionRef=MNFY-20-MER-abc",
          },
        }),
      });

      const provider = new MonnifyProvider(fakeConfig());
      const result = await provider.initialize({
        reference: "dev-bookmi_pmt_xyz",
        amountMinor: 250_000,
        currency: "NGN",
        email: "buyer@example.com",
        callbackUrl: "https://bookmi.co/checkout/callback",
        metadata: {
          checkout_mode: "checkout_url",
          customerName: "Ada Bookings",
          paymentDescription: "30-min consultation",
        },
        channels: ["card", "bank_transfer"],
      });

      expect(result.providerReference).toBe("dev-bookmi_pmt_xyz");
      expect(result.authorizationUrl).toBe(
        "https://sandbox.sdk.monnify.com/checkout?transactionRef=MNFY-20-MER-abc",
      );

      const [initUrl, initInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(initUrl).toBe("https://monnify.test/api/v1/merchant/transactions/init-transaction");
      const initBody = JSON.parse(initInit.body as string) as Record<string, unknown>;
      expect(initBody).toMatchObject({
        amount: "2500.00",
        customerName: "Ada Bookings",
        customerEmail: "buyer@example.com",
        paymentReference: "dev-bookmi_pmt_xyz",
        paymentDescription: "30-min consultation",
        currencyCode: "NGN",
        contractCode: CONTRACT_CODE,
        redirectUrl: "https://bookmi.co/checkout/callback",
        paymentMethods: ["CARD", "ACCOUNT_TRANSFER"],
      });
    });

    it("refuses to call out without a configured contract code", async () => {
      const provider = new MonnifyProvider(fakeConfig({ "monnify.contractCode": undefined }));
      await expect(
        provider.initialize({
          reference: "dev-bookmi_pmt_xyz",
          amountMinor: 100_000,
          currency: "NGN",
          email: "buyer@example.com",
          metadata: { checkout_mode: "checkout_url" },
        }),
      ).rejects.toThrow("contract code not configured");
    });

    it("surfaces a Monnify error when checkoutUrl is missing from the response", async () => {
      mockAuthLogin(fetchMock);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requestSuccessful: false,
          responseMessage: "Contract code invalid",
        }),
      });

      const provider = new MonnifyProvider(fakeConfig());
      await expect(
        provider.initialize({
          reference: "dev-bookmi_pmt_xyz",
          amountMinor: 100_000,
          currency: "NGN",
          email: "buyer@example.com",
          metadata: { checkout_mode: "checkout_url" },
        }),
      ).rejects.toThrow("Contract code invalid");
    });
  });

  describe("verify", () => {
    it("queries by paymentReference, normalizes PAID, converts major→minor", async () => {
      mockAuthLogin(fetchMock);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requestSuccessful: true,
          responseBody: {
            transactionReference: "MNFY|20|MER|abc",
            paymentReference: "dev-bookmi_pmt_xyz",
            amount: "2500.00",
            amountPaid: "2500.00",
            settlementAmount: "2450.50",
            paymentStatus: "PAID",
            paymentMethod: "CARD",
            currencyCode: "NGN",
            paidOn: "10/07/2026 10:00:00 AM",
            cardDetails: {
              cardType: "MASTERCARD",
              last4: "4408",
              expMonth: "10",
              expYear: "30",
              reusable: true,
            },
          },
        }),
      });

      const provider = new MonnifyProvider(fakeConfig());
      const result = await provider.verify("dev-bookmi_pmt_xyz");

      expect(result.status).toBe("success");
      expect(result.amountMinor).toBe(250_000);
      expect(result.netAmountMinor).toBe(245_050);
      expect(result.feeMinor).toBe(250_000 - 245_050);
      expect(result.card?.last4).toBe("4408");
      expect(result.card?.reusable).toBe(true);
      expect(result.paidAt?.toISOString()).toBe("2026-07-10T09:00:00.000Z");
      expect(result.providerTransactionId).toBe("MNFY|20|MER|abc");

      const [verifyUrl] = fetchMock.mock.calls[1] as [string];
      expect(verifyUrl).toBe(
        "https://monnify.test/api/v2/merchant/transactions/query?paymentReference=dev-bookmi_pmt_xyz",
      );
    });

    it("maps PARTIALLY_PAID to processing so finalize does not settle a mismatched amount", async () => {
      mockAuthLogin(fetchMock);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requestSuccessful: true,
          responseBody: {
            transactionReference: "MNFY|x",
            paymentReference: "dev-r",
            amount: "100.00",
            amountPaid: "50.00",
            paymentStatus: "PARTIALLY_PAID",
            currencyCode: "NGN",
          },
        }),
      });
      const provider = new MonnifyProvider(fakeConfig());
      await expect(provider.verify("dev-r")).resolves.toMatchObject({ status: "processing" });
    });

    it("maps EXPIRED/CANCELLED to abandoned", async () => {
      for (const paymentStatus of ["EXPIRED", "CANCELLED"]) {
        fetchMock.mockReset();
        mockAuthLogin(fetchMock);
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            requestSuccessful: true,
            responseBody: {
              transactionReference: "MNFY|x",
              paymentReference: "dev-r",
              amount: "100.00",
              paymentStatus,
              currencyCode: "NGN",
            },
          }),
        });
        const provider = new MonnifyProvider(fakeConfig());
        await expect(provider.verify("dev-r")).resolves.toMatchObject({ status: "abandoned" });
      }
    });

    it("refuses to call out without a configured api key", async () => {
      const provider = new MonnifyProvider(fakeConfig({ "monnify.apiKey": undefined }));
      await expect(provider.verify("dev-r")).rejects.toThrow("API key not configured");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reuses the cached access token across verify calls", async () => {
      mockAuthLogin(fetchMock, "AT_hot", 3300);
      const okBody = () => ({
        ok: true,
        status: 200,
        json: async () => ({
          requestSuccessful: true,
          responseBody: {
            transactionReference: "MNFY|1",
            paymentReference: "dev-r",
            amount: "100.00",
            paymentStatus: "PAID",
            currencyCode: "NGN",
          },
        }),
      });
      fetchMock.mockResolvedValueOnce(okBody());
      fetchMock.mockResolvedValueOnce(okBody());

      const provider = new MonnifyProvider(fakeConfig());
      await provider.verify("dev-r");
      await provider.verify("dev-r");
      expect(fetchMock).toHaveBeenCalledTimes(3); // 1 auth + 2 verify
      const [firstUrl] = fetchMock.mock.calls[0] as [string];
      expect(firstUrl).toContain("/auth/login");
    });
  });

  describe("webhook signature", () => {
    const body = Buffer.from(
      JSON.stringify({
        eventType: "SUCCESSFUL_TRANSACTION",
        eventData: {
          transactionReference: "MNFY|1",
          paymentReference: "dev-r",
          paymentStatus: "PAID",
        },
      }),
    );

    it("accepts a valid HMAC-SHA512 signature", () => {
      const provider = new MonnifyProvider(fakeConfig());
      const signature = createHmac("sha512", SECRET).update(body).digest("hex");
      expect(provider.verifyWebhookSignature(body, { "monnify-signature": signature })).toBe(true);
    });

    it("accepts uppercase-hex signatures (Monnify docs mix cases)", () => {
      const provider = new MonnifyProvider(fakeConfig());
      const signature = createHmac("sha512", SECRET).update(body).digest("hex").toUpperCase();
      expect(provider.verifyWebhookSignature(body, { "monnify-signature": signature })).toBe(true);
    });

    it("rejects a tampered signature", () => {
      const provider = new MonnifyProvider(fakeConfig());
      const signature = createHmac("sha512", SECRET).update(body).digest("hex");
      const tampered = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
      expect(
        provider.verifyWebhookSignature(body, { "monnify-signature": tampered }),
      ).toBe(false);
    });

    it("rejects when the header is missing or no secret is configured", () => {
      const provider = new MonnifyProvider(fakeConfig());
      expect(provider.verifyWebhookSignature(body, {})).toBe(false);

      const noSecret = new MonnifyProvider(fakeConfig({ "monnify.secretKey": undefined }));
      const signature = createHmac("sha512", SECRET).update(body).digest("hex");
      expect(
        noSecret.verifyWebhookSignature(body, { "monnify-signature": signature }),
      ).toBe(false);
    });
  });

  describe("parseWebhook", () => {
    it("uses paymentReference (env-encoded) as providerReference so env routing stays local", () => {
      const provider = new MonnifyProvider(fakeConfig());
      const raw = Buffer.from(
        JSON.stringify({
          eventType: "SUCCESSFUL_TRANSACTION",
          eventData: {
            transactionReference: "MNFY|41|20260717225650|000286",
            paymentReference: "dev-bookmi_pmt_yj9drucj33ttxi2z7sk5",
            paymentStatus: "PAID",
            amountPaid: 20_000,
            settlementAmount: "19990.00",
            currencyCode: "NGN",
            paymentMethod: "CARD",
            paidOn: "2026-07-17 22:59:24.16407166",
            cardDetails: { last4: "1111", reusable: false },
          },
        }),
      );
      const parsed = provider.parseWebhook(raw, {});
      expect(parsed.providerReference).toBe("dev-bookmi_pmt_yj9drucj33ttxi2z7sk5");
      expect(parsed.providerEventId).toBe(
        "monnify:SUCCESSFUL_TRANSACTION:MNFY|41|20260717225650|000286",
      );
      expect(parsed.status).toBe("success");
      expect(parsed.amountMinor).toBe(2_000_000);
      expect(parsed.netAmountMinor).toBe(1_999_000);
      expect(parsed.feeMinor).toBe(1_000);
      expect(parsed.card?.last4).toBe("1111");
      expect(parsed.card?.reusable).toBe(false);
      expect(parsed.paidAt?.toISOString()).toBe("2026-07-17T21:59:24.000Z");
    });

    it("maps FAILED_TRANSACTION and REVERSED_TRANSACTION", () => {
      const provider = new MonnifyProvider(fakeConfig());
      for (const [eventType, expected] of [
        ["FAILED_TRANSACTION", "failed"],
        ["REVERSED_TRANSACTION", "reversed"],
      ] as const) {
        const raw = Buffer.from(
          JSON.stringify({
            eventType,
            eventData: {
              transactionReference: "MNFY|x",
              paymentReference: "dev-r",
              paymentStatus: "FAILED",
            },
          }),
        );
        expect(provider.parseWebhook(raw, {}).status).toBe(expected);
      }
    });

    it("falls back to a body hash when the event has no transactionReference", () => {
      const provider = new MonnifyProvider(fakeConfig());
      const raw = Buffer.from(
        JSON.stringify({ eventType: "SETTLEMENT", eventData: { paymentStatus: "PENDING" } }),
      );
      const parsed = provider.parseWebhook(raw, {});
      expect(parsed.providerEventId).toMatch(/^monnify:SETTLEMENT:sha256:[0-9a-f]{64}$/);
      expect(provider.parseWebhook(raw, {}).providerEventId).toBe(parsed.providerEventId);
    });

    it("rejects malformed bodies", () => {
      const provider = new MonnifyProvider(fakeConfig());
      expect(() => provider.parseWebhook(Buffer.from("not-json"), {})).toThrow(
        "Malformed webhook body",
      );
    });

    it("routes SUCCESSFUL_REFUND/FAILED_REFUND to domain: refund with success/failed status", () => {
      const provider = new MonnifyProvider(fakeConfig());

      const success = provider.parseWebhook(
        Buffer.from(
          JSON.stringify({
            eventType: "SUCCESSFUL_REFUND",
            eventData: {
              refundReference: "refund_abc-123",
              transactionReference: "MNFY|1",
              refundStatus: "COMPLETED",
            },
          }),
        ),
        {},
      );
      expect(success.domain).toBe("refund");
      expect(success.providerReference).toBe("refund_abc-123");
      expect(success.status).toBe("success");
      expect(success.providerEventId).toBe("monnify:SUCCESSFUL_REFUND:refund_abc-123");
      expect(success.failureReason).toBeUndefined();

      const failed = provider.parseWebhook(
        Buffer.from(
          JSON.stringify({
            eventType: "FAILED_REFUND",
            eventData: {
              refundReference: "refund_abc-124",
              refundReason: "Insufficient balance",
            },
          }),
        ),
        {},
      );
      expect(failed.domain).toBe("refund");
      expect(failed.status).toBe("failed");
      expect(failed.failureReason).toBe("Insufficient balance");
    });

    it("falls back to a body hash for a refund webhook with no refundReference", () => {
      const provider = new MonnifyProvider(fakeConfig());
      const raw = Buffer.from(
        JSON.stringify({ eventType: "SUCCESSFUL_REFUND", eventData: {} }),
      );
      const parsed = provider.parseWebhook(raw, {});
      expect(parsed.providerEventId).toMatch(/^monnify:SUCCESSFUL_REFUND:sha256:[0-9a-f]{64}$/);
    });
  });

  describe("refund", () => {
    it("posts to initiate-refund with truncated reason/note and maps COMPLETED to success", async () => {
      mockAuthLogin(fetchMock);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requestSuccessful: true,
          responseBody: {
            refundReference: "refund_abc-123",
            transactionReference: "MNFY|1",
            refundStatus: "COMPLETED",
          },
        }),
      });

      const provider = new MonnifyProvider(fakeConfig());
      const longReason = "x".repeat(100);
      const longNote = "y".repeat(30);
      const result = await provider.refund({
        refundReference: "refund_abc-123",
        transactionReference: "MNFY|1",
        amountMinor: 250_000,
        reason: longReason,
        note: longNote,
        destinationBankCode: "044",
        destinationAccountNumber: "0123456789",
      });

      expect(result.status).toBe("success");
      expect(result.providerReference).toBe("refund_abc-123");

      const [refundUrl, refundInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(refundUrl).toBe("https://monnify.test/api/v1/refunds/initiate-refund");
      const body = JSON.parse(refundInit.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        transactionReference: "MNFY|1",
        refundReference: "refund_abc-123",
        refundAmount: 2500,
        destinationAccountNumber: "0123456789",
        destinationAccountBankCode: "044",
      });
      expect((body.refundReason as string).length).toBe(64);
      expect(body.refundReason).toBe(longReason.slice(0, 64));
      expect((body.customerNote as string).length).toBe(16);
      expect(body.customerNote).toBe(longNote.slice(0, 16));
    });

    it("maps IN_PROGRESS to processing and anything else to failed", async () => {
      for (const [refundStatus, expected] of [
        ["IN_PROGRESS", "processing"],
        ["REJECTED", "failed"],
        [undefined, "failed"],
      ] as const) {
        fetchMock.mockReset();
        mockAuthLogin(fetchMock);
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            requestSuccessful: true,
            responseBody: { refundReference: "refund_x", refundStatus },
          }),
        });
        const provider = new MonnifyProvider(fakeConfig());
        const result = await provider.refund({
          refundReference: "refund_x",
          transactionReference: "MNFY|1",
          reason: "Customer requested",
        });
        expect(result.status).toBe(expected);
      }
    });

    it("omits refundAmount for a full refund (amountMinor not provided)", async () => {
      mockAuthLogin(fetchMock);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requestSuccessful: true,
          responseBody: { refundReference: "refund_full", refundStatus: "COMPLETED" },
        }),
      });
      const provider = new MonnifyProvider(fakeConfig());
      await provider.refund({
        refundReference: "refund_full",
        transactionReference: "MNFY|1",
        reason: "Full refund",
      });
      const [, refundInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(refundInit.body as string) as Record<string, unknown>;
      expect(body.refundAmount).toBeUndefined();
      expect(body.destinationAccountNumber).toBeUndefined();
      expect(body.destinationAccountBankCode).toBeUndefined();
    });

    it("surfaces a Monnify error when the request is unsuccessful", async () => {
      mockAuthLogin(fetchMock);
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          requestSuccessful: false,
          responseMessage: "Transaction reference invalid",
        }),
      });
      const provider = new MonnifyProvider(fakeConfig());
      await expect(
        provider.refund({
          refundReference: "refund_bad",
          transactionReference: "bad-ref",
          reason: "test",
        }),
      ).rejects.toThrow("Transaction reference invalid");
    });
  });
});
