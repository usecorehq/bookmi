import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac } from "node:crypto";
import type {
  Bank,
  DisburseInput,
  DisburseResult,
  InitializeInput,
  InitializeResult,
  NormalizedStatus,
  ParsedWebhook,
  PaymentCardDetails,
  PaymentProvider,
  RefundInput,
  RefundResult,
  ReserveAccountInput,
  ReserveAccountResult,
  VerifyResult,
} from "./payment-provider.interface";

/**
 * Monnify collections API — https://developers.monnify.com/docs/collections/quickstart
 *
 * Two initiate flows supported, picked per-call from `input.metadata.checkout_mode`:
 *
 *  - **`popup`** (default): the frontend calls `monnify-js` directly with
 *    our `paymentReference` (= tx.reference) plus its own publishable apiKey
 *    + contractCode; the backend does NOT hit `init-transaction`. Provider's
 *    `initialize` echoes the reference back so the DB row picks up
 *    `providerReference = reference`. That's the same value the webhook's
 *    `paymentReference` field carries, so lookup lines up.
 *  - **`checkout_url`**: backend calls `POST /api/v1/merchant/transactions/init-transaction`
 *    with our reference + amount + contractCode and returns Monnify's
 *    `checkoutUrl` as `authorizationUrl` for the SPA to redirect into.
 *
 * Regardless of path:
 *  - `verify` uses the paymentReference query endpoint
 *    (`GET /api/v2/merchant/transactions/query?paymentReference=…`) — one
 *    code path for both popup and hosted.
 *  - `parseWebhook` returns `paymentReference` as `providerReference` — that
 *    string carries the env prefix (`dev-bookmi_pmt_…`), so
 *    `environmentFromReference` routes it locally instead of relaying to prod.
 *
 * Auth (for verify + hosted init): POST /api/v1/auth/login with
 * Basic base64(apiKey:secretKey) → bearer token (~1h TTL, cached).
 *
 * Webhook signature: HMAC-SHA512(rawBody, secretKey) in `monnify-signature`.
 *
 * Notable Monnify quirks:
 *  - Amounts are decimal MAJOR units (`"100.00"` = ₦100), unlike Paystack's
 *    integer kobo. Convert on both directions.
 *  - `paidOn` comes back in two shapes across their surfaces — either
 *    `dd/mm/yyyy HH:mm:ss AM/PM` (docs/hosted) or `yyyy-MM-dd HH:mm:ss.SSS…`
 *    (webhook). Both parsed as WAT (+01:00).
 */
@Injectable()
export class MonnifyProvider implements PaymentProvider {
  readonly code = "monnify" as const;
  private readonly logger = new Logger(MonnifyProvider.name);
  /** Cached bearer token (~1h TTL). Refreshed lazily with a 60s safety buffer. */
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) { }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    const mode = readMode(input.metadata);

    // Popup flow (default): no server call.
    if (mode !== "checkout_url") {
      return {
        providerReference: input.reference,
        raw: { mode: "popup", reference: input.reference } as const,
      };
    }

    const baseUrl = this.baseUrl();
    const contractCode = this.requireContractCode();
    const token = await this.getAccessToken();

    const meta = (input.metadata ?? {}) as Record<string, unknown>;
    const body: MonnifyInitRequest = {
      amount: minorToMajor(input.amountMinor),
      customerName: typeof meta.customerName === "string" ? meta.customerName : input.email,
      customerEmail: input.email,
      paymentReference: input.reference,
      paymentDescription:
        typeof meta.paymentDescription === "string" ? meta.paymentDescription : "Bookmi payment",
      currencyCode: input.currency,
      contractCode,
      redirectUrl: input.callbackUrl,
      ...(input.channels?.length
        ? { paymentMethods: input.channels.map(mapChannelToMonnifyMethod) }
        : {}),
    };

    const res = await fetch(`${baseUrl}/api/v1/merchant/transactions/init-transaction`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = (await res.json().catch(() => null)) as MonnifyInitBody | null;
    if (!res.ok || !parsed?.requestSuccessful || !parsed.responseBody?.checkoutUrl) {
      this.logger.warn(
        `Monnify init-transaction failed: ${res.status} ${parsed?.responseMessage ?? "unknown"}`,
      );
      throw new BadGatewayException(parsed?.responseMessage ?? "Monnify initiate failed");
    }

    return {
      providerReference: input.reference,
      authorizationUrl: parsed.responseBody.checkoutUrl,
      raw: parsed,
    };
  }

  async verify(providerReference: string): Promise<VerifyResult> {
    const baseUrl = this.baseUrl();
    const token = await this.getAccessToken();

    const res = await fetch(
      `${baseUrl}/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(providerReference)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    );

    const parsed = (await res.json().catch(() => null)) as MonnifyVerifyBody | null;
    if (!res.ok || !parsed?.requestSuccessful || !parsed.responseBody) {
      this.logger.warn(
        `Monnify verify failed: ${res.status} ${parsed?.responseMessage ?? "unknown"}`,
      );
      throw new BadGatewayException(parsed?.responseMessage ?? "Monnify verify failed");
    }

    const data = parsed.responseBody;
    const amountMinor = majorToMinor(data.amount);
    const paidMinor = data.amountPaid != null ? majorToMinor(data.amountPaid) : amountMinor;
    const netMinor =
      data.settlementAmount != null ? majorToMinor(data.settlementAmount) : undefined;
    const feeMinor =
      data.fee != null
        ? majorToMinor(data.fee)
        : netMinor != null
          ? paidMinor - netMinor
          : undefined;

    return {
      status: normalizeStatus(data.paymentStatus),
      providerReference: data.transactionReference,
      providerTransactionId: data.transactionReference,
      amountMinor: paidMinor,
      currency: data.currencyCode,
      feeMinor,
      netAmountMinor: netMinor ?? (feeMinor != null ? paidMinor - feeMinor : undefined),
      paidAt: parseMonnifyDate(data.paidOn),
      customerCode: data.customerDetails?.customerReference,
      card: cardFromMonnify(data),
      failureReason:
        data.paymentStatus === "PAID" || data.paymentStatus === "OVERPAID"
          ? undefined
          : (data.paymentDescription ?? data.paymentStatus),
      raw: parsed,
    };
  }

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const signature = headerString(headers["monnify-signature"]);
    if (!signature) return false;
    const secret = this.config.get<string>("monnify.secretKey");
    if (!secret) return false;
    const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
    // Monnify docs vary on hex case — normalize both to lowercase before compare.
    return timingSafeEqualHex(signature.toLowerCase(), expected);
  }

  parseWebhook(
    rawBody: Buffer,
    _headers: Record<string, string | string[] | undefined>,
  ): ParsedWebhook {
    let payload: MonnifyWebhookBody;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as MonnifyWebhookBody;
    } catch {
      throw new UnauthorizedException("Malformed webhook body");
    }

    const eventType = payload.eventType ?? "unknown";

    if (eventType === "SUCCESSFUL_REFUND" || eventType === "FAILED_REFUND") {
      return parseRefundWebhook(eventType, payload, rawBody);
    }

    if (eventType === "RESERVED_ACCOUNT_TRANSACTION") {
      return parseReservedAccountWebhook(payload, rawBody);
    }

    const data = payload.eventData ?? {};
    const paymentReference = data.paymentReference ?? "";

    // Monnify events don't carry a stable event id, so we compose one from
    // (event, transactionReference) — that's globally unique across retries.
    const providerEventId = data.transactionReference
      ? `monnify:${eventType}:${data.transactionReference}`
      : `monnify:${eventType}:sha256:${createHash("sha256").update(rawBody).digest("hex")}`;

    const amountMinor = data.amountPaid != null ? majorToMinor(data.amountPaid) : undefined;
    const netMinor =
      data.settlementAmount != null ? majorToMinor(data.settlementAmount) : undefined;
    const feeMinor =
      data.fee != null
        ? majorToMinor(data.fee)
        : amountMinor != null && netMinor != null
          ? amountMinor - netMinor
          : undefined;

    return {
      providerEventId,
      providerReference: paymentReference,
      providerTransactionId: data.transactionReference,
      status: normalizeWebhookStatus(eventType, data.paymentStatus),
      eventName: eventType,
      amountMinor,
      currency: data.currencyCode,
      feeMinor,
      netAmountMinor:
        netMinor ?? (amountMinor != null && feeMinor != null ? amountMinor - feeMinor : undefined),
      paidAt: parseMonnifyDate(data.paidOn),
      customerCode: data.customer?.customerReference,
      card: cardFromMonnify(data),
      failureReason:
        eventType === "SUCCESSFUL_TRANSACTION"
          ? undefined
          : (data.paymentDescription ?? undefined),
      raw: payload,
    };
  }

  // ─── disbursement helpers ────────────────────────────────────────

  async listBanks(): Promise<Bank[]> {
    const baseUrl = this.baseUrl();
    const token = await this.getAccessToken();

    const res = await fetch(`${baseUrl}/api/v1/banks`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = (await res.json().catch(() => null)) as MonnifyBanksBody | null;
    if (!res.ok || !parsed?.requestSuccessful || !Array.isArray(parsed.responseBody)) {
      this.logger.warn(
        `Monnify list-banks failed: ${res.status} ${parsed?.responseMessage ?? "unknown"}`,
      );
      throw new BadRequestException(parsed?.responseMessage ?? "Monnify list banks failed");
    }

    return parsed.responseBody
      .filter((b): b is { name: string; code: string } => !!b?.name && !!b?.code)
      .map((b) => ({ code: b.code, name: b.name }));
  }

  async resolveBankAccount(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<{ accountName: string; bankName: string }> {
    const baseUrl = this.baseUrl();
    const token = await this.getAccessToken();

    const url =
      `${baseUrl}/api/v1/disbursements/account/validate` +
      `?accountNumber=${encodeURIComponent(input.accountNumber)}` +
      `&bankCode=${encodeURIComponent(input.bankCode)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = (await res.json().catch(() => null)) as MonnifyValidateBody | null;
    if (!res.ok || !parsed?.requestSuccessful || !parsed.responseBody) {
      this.logger.warn(
        `Monnify validate-account failed: ${res.status} ${parsed?.responseMessage ?? "unknown"}`,
      );
      throw new BadRequestException(
        parsed?.responseMessage ?? "Could not verify that account.",
      );
    }

    return {
      accountName: parsed.responseBody.accountName ?? "",
      // Monnify's validate endpoint typically omits bankName — dropdown owns
      // the display name, so an empty fallback is fine.
      bankName: parsed.responseBody.bankName ?? "",
    };
  }

  /**
   * Provision a reserved/dedicated virtual account for a host —
   * `POST /api/v2/bank-transfer/reserved-accounts`
   * (https://developers.monnify.com/docs/collections/recurring-payments/reserved-accounts).
   * Auth is the bearer token, same as every other Monnify call here. Request
   * and response shapes below are taken directly from Monnify's docs, not
   * inferred.
   *
   * `accountReference` doubles as Monnify's own upsert key for the account.
   * Whether a retried call with the same reference returns/updates the
   * existing reserved account rather than erroring is NOT covered by the
   * docs snippet this was built from — smoke-test a retry against sandbox
   * before enabling `MONNIFY_USE_RESERVED_ACCOUNT_API` in production.
   *
   * Money paid into the resulting account number(s) is reported later via a
   * `RESERVED_ACCOUNT_TRANSACTION` webhook — see `parseReservedAccountWebhook`
   * (that webhook's field names are still inferred, unlike this call).
   */
  async reserveAccount(input: ReserveAccountInput): Promise<ReserveAccountResult> {
    const baseUrl = this.baseUrl();
    const contractCode = this.requireContractCode();
    const token = await this.getAccessToken();

    const body: MonnifyReserveAccountRequest = {
      accountReference: input.accountReference,
      accountName: input.accountName,
      currencyCode: input.currencyCode ?? "NGN",
      contractCode,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      bvn: input.bvn,
      ...(input.preferredBankCodes?.length
        ? { preferredBanks: input.preferredBankCodes }
        : { getAllAvailableBanks: true }),
    };

    const res = await fetch(`${baseUrl}/api/v2/bank-transfer/reserved-accounts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const parsed = (await res.json().catch(() => null)) as MonnifyReserveAccountBody | null;
    if (!res.ok || !parsed?.requestSuccessful || !parsed.responseBody?.accounts?.length) {
      this.logger.warn(
        `Monnify reserve-account failed: ${res.status} ${parsed?.responseMessage ?? "unknown"}`,
      );
      throw new BadRequestException(
        parsed?.responseMessage ?? "Monnify reserved account creation failed",
      );
    }

    return {
      accountReference: parsed.responseBody.accountReference ?? input.accountReference,
      accountName: parsed.responseBody.accountName ?? input.accountName,
      reservationReference: parsed.responseBody.reservationReference,
      accounts: parsed.responseBody.accounts
        .filter((a): a is { bankCode: string; bankName: string; accountNumber: string; accountName?: string } =>
          Boolean(a?.bankCode && a?.bankName && a?.accountNumber),
        )
        .map((a) => ({
          bankCode: a.bankCode,
          bankName: a.bankName,
          accountNumber: a.accountNumber,
          accountName: a.accountName,
        })),
      raw: parsed,
    };
  }

  /**
   * Initiate a single bank transfer via Monnify's disbursement API. Used by
   * the refund flow to send money back to the customer's bank account.
   *
   * `POST /api/v2/disbursements/single` — auth is the bearer token, same as
   * the collection endpoints. Requires a linked source wallet (`sourceAccountNumber`)
   * that Monnify draws funds from; see `MONNIFY_DISBURSEMENT_WALLET`.
   *
   * Monnify's status vocabulary maps into our four-state enum:
   *   SUCCESS/COMPLETED → success, PENDING → pending, PROCESSING → processing,
   *   everything else (FAILED, REVERSED, EXPIRED, ...) → failed.
   */
  async disburse(input: DisburseInput): Promise<DisburseResult> {
    const sourceAccountNumber = this.config.get<string>("monnify.disbursementWallet");

    if (!sourceAccountNumber) {
      throw new BadRequestException(
        "Disbursement wallet not configured — set MONNIFY_DISBURSEMENT_WALLET.",
      );
    }

    const baseUrl = this.baseUrl();
    const token = await this.getAccessToken();

    const body = {
      amount: minorToMajor(input.amountMinor),
      reference: input.reference,
      narration: input.narration ?? "Bookmi disbursement",
      destinationBankCode: input.destinationBankCode,
      destinationAccountNumber: input.destinationAccountNumber,
      destinationAccountName: input.destinationAccountName,
      currency: input.currency ?? "NGN",
      sourceAccountNumber,
    };

    const res = await fetch(`${baseUrl}/api/v2/disbursements/single`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const parsed = (await res.json().catch(() => null)) as MonnifyDisburseBody | null;

    if (!parsed?.requestSuccessful) {
      this.logger.warn(
        `Monnify disburse failed: ${res.status} ${parsed?.responseMessage ?? "unknown"}`,
      );
      throw new BadRequestException(parsed?.responseMessage ?? "Monnify disburse failed");
    }

    return {
      providerReference: parsed.responseBody?.reference ?? input.reference,
      status: mapDisburseStatus(parsed.responseBody?.status),
      raw: parsed,
    };
  }

  /**
   * Initiate a refund via Monnify's dedicated refund API — addresses the
   * ORIGINAL transaction by Monnify's own reference (`transactionReference`,
   * captured by `verify()`/`parseWebhook()` into `providerTransactionId`)
   * rather than moving money to an arbitrary destination from scratch.
   *
   * `POST /api/v1/refunds/initiate-refund` — same bearer-token auth as every
   * other Monnify call here.
   *
   * Monnify's `refundStatus` maps: COMPLETED → success, IN_PROGRESS →
   * processing, everything else → failed.
   *
   * OPEN RISK (flagged in the implementation plan, not verified against a
   * live sandbox yet): Monnify's docs describe `refundAmount` as a "number,"
   * but every other amount field this codebase integrates with is a decimal
   * string (see `minorToMajor`). Sending a JS number here may be wrong —
   * smoke-test against Monnify's sandbox before enabling
   * `MONNIFY_USE_REFUND_API` in production and adjust if the number form is
   * rejected or misinterpreted.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    const baseUrl = this.baseUrl();
    const token = await this.getAccessToken();

    const body: Record<string, unknown> = {
      transactionReference: input.transactionReference,
      refundReference: input.refundReference,
      refundReason: truncate(input.reason, 64),
      ...(input.amountMinor != null
        ? { refundAmount: Number(minorToMajor(input.amountMinor)) }
        : {}),
      ...(input.note != null ? { customerNote: truncate(input.note, 16) } : {}),
      ...(input.destinationAccountNumber
        ? { destinationAccountNumber: input.destinationAccountNumber }
        : {}),
      ...(input.destinationBankCode
        ? { destinationAccountBankCode: input.destinationBankCode }
        : {}),
    };

    const res = await fetch(`${baseUrl}/api/v1/refunds/initiate-refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const parsed = (await res.json().catch(() => null)) as MonnifyRefundBody | null;

    if (!parsed?.requestSuccessful) {
      this.logger.warn(
        `Monnify refund failed: ${res.status} ${parsed?.responseMessage ?? "unknown"}`,
      );
      throw new BadRequestException(parsed?.responseMessage ?? "Monnify refund failed");
    }

    return {
      providerReference: parsed.responseBody?.refundReference ?? input.refundReference,
      status: mapRefundStatus(parsed.responseBody?.refundStatus),
      raw: parsed,
    };
  }

  // ─── auth ────────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const baseUrl = this.baseUrl();
    const apiKey = this.requireApiKey();
    const secret = this.requireSecretKey();
    const basic = Buffer.from(`${apiKey}:${secret}`).toString("base64");

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = (await res.json().catch(() => null)) as MonnifyAuthBody | null;
    if (!res.ok || !parsed?.requestSuccessful || !parsed.responseBody?.accessToken) {
      this.logger.warn(
        `Monnify login failed: ${res.status} ${parsed?.responseMessage ?? "unknown"}`,
      );
      throw new BadGatewayException(parsed?.responseMessage ?? "Monnify auth failed");
    }

    const ttlSeconds = parsed.responseBody.expiresIn ?? 3300;
    this.tokenCache = {
      token: parsed.responseBody.accessToken,
      expiresAt: now + ttlSeconds * 1000,
    };
    return this.tokenCache.token;
  }

  // ─── config accessors ────────────────────────────────────────────

  private baseUrl(): string {
    return this.config.getOrThrow<string>("monnify.baseUrl");
  }

  private requireApiKey(): string {
    const v = this.config.get<string>("monnify.apiKey");
    if (!v) throw new BadGatewayException("Monnify API key not configured");
    return v;
  }

  private requireSecretKey(): string {
    const v = this.config.get<string>("monnify.secretKey");
    if (!v) throw new BadGatewayException("Monnify secret key not configured");
    return v;
  }

  private requireContractCode(): string {
    const v = this.config.get<string>("monnify.contractCode");
    if (!v) throw new BadGatewayException("Monnify contract code not configured");
    return v;
  }
}

// ─── helpers ────────────────────────────────────────────────────────

/** Monnify's decimal strings/numbers → integer kobo. */
function majorToMinor(major: string | number): number {
  const n = typeof major === "string" ? parseFloat(major) : major;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Integer kobo → Monnify's decimal-string major (2dp), e.g. 250000 → "2500.00". */
function minorToMajor(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Extract the caller's requested initiate mode, if any. */
function readMode(
  metadata: Record<string, unknown> | undefined,
): "popup" | "checkout_url" | undefined {
  const raw = metadata?.checkout_mode;
  if (raw === "popup" || raw === "checkout_url") return raw;
  return undefined;
}

/** Our neutral channel names → Monnify's paymentMethods enum. */
function mapChannelToMonnifyMethod(channel: string): string {
  switch (channel.toLowerCase()) {
    case "card":
      return "CARD";
    case "bank_transfer":
    case "account_transfer":
      return "ACCOUNT_TRANSFER";
    case "ussd":
      return "USSD";
    case "mobile_money":
    case "phone_number":
      return "PHONE_NUMBER";
    default:
      return channel.toUpperCase();
  }
}

function normalizeStatus(providerStatus: string | undefined): NormalizedStatus {
  switch (providerStatus) {
    case "PAID":
    case "OVERPAID":
      return "success";
    case "FAILED":
      return "failed";
    case "EXPIRED":
    case "CANCELLED":
      return "abandoned";
    case "PARTIALLY_PAID":
      // finalize() refuses success on amount mismatch, so this is safely
      // parked as processing until the customer tops up or Monnify expires it.
      return "processing";
    case "PENDING":
      return "pending";
    default:
      return "pending";
  }
}

function mapDisburseStatus(
  providerStatus: string | undefined,
): DisburseResult["status"] {
  switch (providerStatus?.toUpperCase()) {
    case "SUCCESS":
    case "COMPLETED":
      return "success";
    case "PENDING":
    case "PENDING_AUTHORIZATION": //for when 
      return "pending";
    case "PROCESSING":
      return "processing";
    default:
      return "failed";
  }
}

function mapRefundStatus(providerStatus: string | undefined): RefundResult["status"] {
  switch (providerStatus?.toUpperCase()) {
    case "COMPLETED":
      return "success";
    case "IN_PROGRESS":
      return "processing";
    default:
      return "failed";
  }
}

/** Truncate to `max` chars — Monnify silently truncates some refund fields server-side; do it ourselves so what we log matches what Monnify stores. */
function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Parse a `SUCCESSFUL_REFUND` / `FAILED_REFUND` webhook into a `domain:
 * "refund"` ParsedWebhook, routed by `PaymentsService.processWebhook` to
 * `RefundWebhookService` instead of the payment-transaction finalize path.
 *
 * OPEN RISK (flagged in the implementation plan, not verified against a live
 * sandbox yet): the exact `eventData` field names below are INFERRED by
 * analogy to the `initiate-refund` response shape (the same way
 * `SUCCESSFUL_TRANSACTION`'s `eventData` mirrors `verify()`'s response
 * body) — Monnify's docs don't show a worked refund-webhook payload. Log the
 * first real sandbox webhook and adjust field names here if they differ
 * before enabling `MONNIFY_USE_REFUND_API` in production.
 */
function parseRefundWebhook(
  eventType: "SUCCESSFUL_REFUND" | "FAILED_REFUND",
  payload: MonnifyWebhookBody,
  rawBody: Buffer,
): ParsedWebhook {
  const data = (payload.eventData ?? {}) as MonnifyRefundEventData;
  const refundReference = data.refundReference ?? "";

  const providerEventId = refundReference
    ? `monnify:${eventType}:${refundReference}`
    : `monnify:${eventType}:sha256:${createHash("sha256").update(rawBody).digest("hex")}`;

  return {
    providerEventId,
    providerReference: refundReference,
    domain: "refund",
    status: eventType === "SUCCESSFUL_REFUND" ? "success" : "failed",
    eventName: eventType,
    failureReason: eventType === "FAILED_REFUND" ? data.refundReason : undefined,
    raw: payload,
  };
}

/**
 * Parse a `RESERVED_ACCOUNT_TRANSACTION` webhook — fired when a transfer
 * lands in a host's reserved account — into a `domain:
 * "reserved_account_credit"` ParsedWebhook, routed by
 * `PaymentsService.processWebhook` to `ReservedAccountWebhookService`.
 *
 * OPEN RISK (flagged, not verified against a live sandbox yet): the exact
 * `eventData` field names below (particularly `product.reference` for the
 * account reference, and `currency` vs `currencyCode`) are INFERRED from
 * Monnify's reserved-account docs, not a captured real payload. Log the
 * first real sandbox webhook and adjust field names here if they differ
 * before enabling `MONNIFY_USE_RESERVED_ACCOUNT_API` in production.
 */
function parseReservedAccountWebhook(
  payload: MonnifyWebhookBody,
  rawBody: Buffer,
): ParsedWebhook {
  const data = (payload.eventData ?? {}) as MonnifyReservedAccountEventData;
  const transactionReference = data.transactionReference ?? "";

  const providerEventId = transactionReference
    ? `monnify:RESERVED_ACCOUNT_TRANSACTION:${transactionReference}`
    : `monnify:RESERVED_ACCOUNT_TRANSACTION:sha256:${createHash("sha256").update(rawBody).digest("hex")}`;

  return {
    providerEventId,
    providerReference: data.paymentReference ?? transactionReference,
    providerTransactionId: transactionReference,
    domain: "reserved_account_credit",
    accountReference: data.product?.reference,
    status:
      data.paymentStatus === "PAID" || data.paymentStatus === "OVERPAID" ? "success" : "failed",
    eventName: "RESERVED_ACCOUNT_TRANSACTION",
    amountMinor: data.amountPaid != null ? majorToMinor(data.amountPaid) : undefined,
    currency: data.currencyCode ?? data.currency,
    paidAt: parseMonnifyDate(data.paidOn),
    customerCode: data.customer?.customerReference,
    payerName: data.customer?.name,
    failureReason:
      data.paymentStatus === "PAID" || data.paymentStatus === "OVERPAID"
        ? undefined
        : (data.paymentDescription ?? data.paymentStatus),
    raw: payload,
  };
}

function normalizeWebhookStatus(
  event: string,
  providerStatus: string | undefined,
): NormalizedStatus {
  switch (event) {
    case "SUCCESSFUL_TRANSACTION":
      return "success";
    case "FAILED_TRANSACTION":
      return "failed";
    case "REVERSED_TRANSACTION":
      return "reversed";
    default:
      return normalizeStatus(providerStatus);
  }
}

function cardFromMonnify(data: MonnifyEventData): PaymentCardDetails | undefined {
  const method = (data.paymentMethod ?? "").toUpperCase();
  const card = data.cardDetails;
  if (!card && method !== "CARD") {
    return method ? { channel: mapMonnifyMethodToChannel(method) } : undefined;
  }
  return {
    cardType: card?.cardType,
    last4: card?.last4,
    expMonth: card?.expMonth,
    expYear: card?.expYear,
    bank: card?.bankName,
    channel: mapMonnifyMethodToChannel(method || "CARD"),
    reusable: card?.reusable,
  };
}

function mapMonnifyMethodToChannel(method: string): string {
  switch (method) {
    case "CARD":
      return "card";
    case "ACCOUNT_TRANSFER":
      return "bank_transfer";
    case "USSD":
      return "ussd";
    case "PHONE_NUMBER":
      return "mobile_money";
    default:
      return method.toLowerCase();
  }
}

/**
 * Monnify returns `paidOn` in two shapes; parse both and normalize to UTC.
 * Return undefined on malformed input rather than throwing so a payment still
 * finalizes if the timestamp field ever changes shape.
 */
function parseMonnifyDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();

  // Webhook format: `yyyy-MM-dd HH:mm:ss[.fractional]` in WAT.
  const wat = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/,
  );
  if (wat) {
    return new Date(
      Date.UTC(
        parseInt(wat[1]!, 10),
        parseInt(wat[2]!, 10) - 1,
        parseInt(wat[3]!, 10),
        parseInt(wat[4]!, 10) - 1, // WAT (UTC+1) → UTC
        parseInt(wat[5]!, 10),
        parseInt(wat[6]!, 10),
      ),
    );
  }

  const m = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!m) return undefined;
  let hh = parseInt(m[4]!, 10);
  const meridiem = m[7];
  if (meridiem) {
    const upper = meridiem.toUpperCase();
    if (upper === "PM" && hh < 12) hh += 12;
    if (upper === "AM" && hh === 12) hh = 0;
  }
  const utcMs = Date.UTC(
    parseInt(m[3]!, 10),
    parseInt(m[2]!, 10) - 1,
    parseInt(m[1]!, 10),
    hh - 1,
    parseInt(m[5]!, 10),
    parseInt(m[6]!, 10),
  );
  return new Date(utcMs);
}

function headerString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── provider response shapes (partial) ─────────────────────────────

interface MonnifyAuthBody {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseBody?: { accessToken: string; expiresIn?: number };
}

interface MonnifyInitRequest {
  amount: string;
  customerName: string;
  customerEmail: string;
  paymentReference: string;
  paymentDescription: string;
  currencyCode: string;
  contractCode: string;
  redirectUrl?: string;
  paymentMethods?: string[];
}

interface MonnifyInitBody {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseBody?: {
    transactionReference: string;
    paymentReference: string;
    merchantName?: string;
    checkoutUrl?: string;
  };
}

interface MonnifyCardDetails {
  cardType?: string;
  last4?: string;
  expMonth?: string;
  expYear?: string;
  bin?: string;
  bankName?: string;
  reusable?: boolean;
}

interface MonnifyEventData {
  transactionReference?: string;
  paymentReference?: string;
  amount?: number | string;
  amountPaid?: number | string;
  settlementAmount?: number | string;
  fee?: number | string;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentDescription?: string;
  currencyCode?: string;
  paidOn?: string;
  cardDetails?: MonnifyCardDetails;
  customer?: { name?: string; email?: string; customerReference?: string };
  customerDetails?: { name?: string; email?: string; customerReference?: string };
}

interface MonnifyVerifyBody {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseBody?: MonnifyEventData & {
    transactionReference: string;
    amount: number | string;
    currencyCode: string;
  };
}

interface MonnifyWebhookBody {
  eventType?: string;
  eventData?: MonnifyEventData;
}

interface MonnifyBanksBody {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseBody?: Array<{ name?: string; code?: string; ussdTemplate?: string | null }>;
}

interface MonnifyValidateBody {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseBody?: {
    accountNumber?: string;
    accountName?: string;
    bankCode?: string;
    bankName?: string;
  };
}

interface MonnifyRefundBody {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseBody?: {
    refundReference?: string;
    transactionReference?: string;
    /** COMPLETED | IN_PROGRESS | FAILED | REJECTED (inferred, see mapRefundStatus). */
    refundStatus?: string;
    refundAmount?: number | string;
    customerNote?: string;
    refundReason?: string;
  };
}

/**
 * Shape of `SUCCESSFUL_REFUND`/`FAILED_REFUND` webhook `eventData`. INFERRED
 * by analogy to `MonnifyRefundBody.responseBody` — see `parseRefundWebhook`'s
 * open-risk comment. Adjust field names once a real sandbox payload is seen.
 */
interface MonnifyRefundEventData {
  refundReference?: string;
  transactionReference?: string;
  refundStatus?: string;
  refundAmount?: number | string;
  refundReason?: string;
}

interface MonnifyReserveAccountRequest {
  accountReference: string;
  accountName: string;
  currencyCode: string;
  contractCode: string;
  customerEmail: string;
  customerName: string;
  bvn: string;
  getAllAvailableBanks?: boolean;
  preferredBanks?: string[];
}

/**
 * Confirmed from Monnify's reserved-accounts docs (not inferred) — see the
 * `reserveAccount()` JSDoc for the source link. `responseBody` also carries
 * `collectionChannel`, `reservedAccountType`, `status`, `createdOn`,
 * `incomeSplitConfig`, `bvn`, `restrictPaymentSource`, none of which bookmi
 * currently persists.
 */
interface MonnifyReserveAccountBody {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: {
    contractCode?: string;
    accountReference?: string;
    accountName?: string;
    currencyCode?: string;
    customerEmail?: string;
    customerName?: string;
    reservationReference?: string;
    accounts?: Array<{
      bankCode?: string;
      bankName?: string;
      accountNumber?: string;
      accountName?: string;
    }>;
    status?: string;
  };
}

/**
 * Shape of `RESERVED_ACCOUNT_TRANSACTION` webhook `eventData`. INFERRED from
 * Monnify's reserved-account docs — see `parseReservedAccountWebhook`'s
 * open-risk comment. Adjust field names once a real sandbox payload is seen.
 */
interface MonnifyReservedAccountEventData {
  transactionReference?: string;
  paymentReference?: string;
  amountPaid?: number | string;
  paymentStatus?: string;
  paymentDescription?: string;
  currencyCode?: string;
  currency?: string;
  paidOn?: string;
  product?: { type?: string; reference?: string };
  customer?: { name?: string; email?: string; customerReference?: string };
}

interface MonnifyDisburseBody {
  requestSuccessful: boolean;
  responseMessage?: string;
  responseBody?: {
    /** Echoed idempotency reference — same value we minted client-side. */
    reference?: string;
    /** SUCCESS | COMPLETED | PENDING | PROCESSING | FAILED | REVERSED | EXPIRED. */
    status?: string;
    amount?: number | string;
    fee?: number | string;
    transactionDescription?: string;
    dateCreated?: string;
  };
}
