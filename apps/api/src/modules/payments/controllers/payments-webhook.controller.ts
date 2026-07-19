import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Public } from "../../../common/decorators/public.decorator";
import { PaymentsService } from "../services/payments.service";

/**
 * Provider webhooks land here. Signature verification runs against
 * `req.rawBody` (Buffer) — enabled by `rawBody: true` on NestFactory.create.
 *
 * Public: the HMAC signature IS the authentication. A JWT-guarded webhook
 * URL is a broken webhook URL.
 *
 * Providers retry on non-2xx. Return 200 for anything the system handled OR
 * chose to safely ignore (duplicate, unknown ref) so they stop retrying.
 */
@ApiTags("payments")
@Public()
@Controller({ path: "payments/webhook" })
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(private readonly payments: PaymentsService) {}

  @Post(":provider")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Receive a provider webhook. HMAC signature verified against the raw body; no JWT required.",
  })
  async receive(
    @Param("provider") providerCode: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      this.logger.warn(
        `Webhook to /${providerCode} arrived without raw body — check main.ts wiring`,
      );
      return { received: false, reason: "no raw body" };
    }
    const result = await this.payments.processWebhook(
      providerCode,
      req.rawBody,
      req.headers,
    );
    return { received: true, ...result };
  }
}
