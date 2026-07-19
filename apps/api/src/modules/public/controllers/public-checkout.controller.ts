import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { PaymentsService } from "../../payments/services/payments.service";
import { PublicCheckoutDto, PublicCheckoutSchema } from "../dto/public.dto";
import { PublicCheckoutService } from "../services/public-checkout.service";

@ApiTags("public")
@Public()
@Controller({ path: "public" })
export class PublicCheckoutController {
  constructor(
    private readonly checkout: PublicCheckoutService,
    private readonly payments: PaymentsService,
  ) {}

  @Post(":slug/:serviceSlug/checkout")
  @ApiOperation({
    summary:
      "Atomic public checkout — creates the pending booking + initializes payment. Handles booking + tip services.",
  })
  async create(
    @Param("slug") slug: string,
    @Param("serviceSlug") serviceSlug: string,
    @Body(new ZodValidationPipe(PublicCheckoutSchema)) body: PublicCheckoutDto,
  ) {
    return this.checkout.checkout(slug, serviceSlug, body);
  }

  @Get("checkout/:reference/verify")
  @ApiOperation({
    summary:
      "Verify a public-checkout reference. No auth — the reference itself is the capability; only public status fields are returned.",
  })
  async verify(@Param("reference") reference: string) {
    // Anonymous verify (no requestingUserId) — the reference gates the
    // capability. Public checkouts set initiatorUserId = booking.id so
    // there's no owning user to check against anyway.
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
}
