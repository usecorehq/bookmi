import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from "@nestjs/common";
import { InitiatePaymentDto } from "../dto/payments.dto";
import { PaymentsService } from "../services/payments.service";

/**
 * Bookmi payments API.
 *
 * Auth is not enforced yet — Day 1 wires a Supabase JWT guard that populates
 * `initiatorUserId` from the token. Until then the body carries it explicitly
 * for guest-checkout callers (the customer paying for a booking).
 */
@Controller({ path: "payments" })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("initiate")
  initiate(
    @Body() body: InitiatePaymentDto,
    @Headers("idempotency-key") headerKey?: string,
  ) {
    // Guest checkout — until auth lands the caller must send initiatorUserId
    // (customer's Supabase user id). It's a normal UUID; PaymentsService uses
    // it to scope the idempotency-key uniqueness.
    if (!body.initiatorUserId) {
      throw new BadRequestException(
        "initiatorUserId is required until the auth guard is wired",
      );
    }
    return this.payments.initiate({
      purposeType: body.purposeType,
      purposeId: body.purposeId,
      amountMinor: body.amountMinor,
      currency: body.currency,
      countryCode: body.countryCode,
      businessId: body.businessId,
      email: body.email,
      initiatorUserId: body.initiatorUserId,
      metadata: body.metadata,
      callbackUrl: body.callbackUrl,
      checkoutMode: body.checkoutMode,
      idempotencyKey: headerKey ?? body.idempotencyKey,
    });
  }

  @Get(":reference/verify")
  async verify(@Param("reference") reference: string) {
    const tx = await this.payments.verify(reference);
    return {
      reference: tx.reference,
      status: tx.status,
      amountMinor: tx.amountMinor,
      currency: tx.currency,
      provider: tx.providerCode,
      completedAt: tx.completedAt,
    };
  }

  @Get(":reference")
  async get(@Param("reference") reference: string) {
    const tx = await this.payments.findByReferenceOrThrow(reference);
    return {
      reference: tx.reference,
      status: tx.status,
      amountMinor: tx.amountMinor,
      currency: tx.currency,
      provider: tx.providerCode,
      purposeType: tx.purposeType,
      purposeId: tx.purposeId,
      businessId: tx.businessId,
      accessCode: tx.accessCode ?? undefined,
      authorizationUrl: tx.authorizationUrl ?? undefined,
      completedAt: tx.completedAt,
      initiatedAt: tx.initiatedAt,
    };
  }
}
