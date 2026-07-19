import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { InitiatePaymentDto, InitiatePaymentSchema } from "../dto/payments.dto";
import { PaymentsService } from "../services/payments.service";

/**
 * Bookmi payments API. All endpoints require a valid Supabase JWT — the
 * global SupabaseJwtGuard populates `@CurrentUser()` before the handler runs.
 */
@ApiTags("payments")
@ApiBearerAuth()
@Controller({ path: "payments" })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("initiate")
  @ApiOperation({
    summary:
      "Start a payment. Server derives the reference, resolves provider by country, calls provider.initialize, returns the popup access_code or hosted redirect URL.",
  })
  initiate(
    // Pipe stays on the body param only — a method-level pipe would also
    // run against the header and user params and reject every valid request.
    @Body(new ZodValidationPipe(InitiatePaymentSchema)) body: InitiatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.payments.initiate({
      purposeType: body.purposeType,
      purposeId: body.purposeId,
      amountMinor: body.amountMinor,
      currency: body.currency,
      countryCode: body.countryCode,
      businessId: body.businessId,
      email: body.email,
      initiatorUserId: user.sub,
      metadata: body.metadata,
      callbackUrl: body.callbackUrl,
      checkoutMode: body.checkoutMode,
      idempotencyKey: idempotencyKey ?? body.idempotencyKey,
    });
  }

  @Get(":reference/verify")
  @ApiOperation({
    summary:
      "Verify a transaction with the provider. Safe to call from the Monnify popup onSuccess callback — idempotent, cheap when already resolved.",
  })
  async verify(
    @Param("reference") reference: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tx = await this.payments.verify(reference, user.sub);
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
  @ApiOperation({ summary: "Read the current state of a transaction (no provider round-trip)." })
  async get(
    @Param("reference") reference: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tx = await this.payments.findByReferenceOrThrow(reference, user.sub);
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
