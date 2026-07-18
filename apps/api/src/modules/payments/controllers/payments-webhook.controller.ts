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
import type { Request } from "express";
import { PaymentsService } from "../services/payments.service";

/**
 * Provider webhooks land here. Signature verification runs against
 * `req.rawBody` (Buffer) — enabled by `rawBody: true` on NestFactory.create.
 *
 * Providers retry on non-2xx. Return 200 for anything the system handled OR
 * chose to safely ignore (duplicate, unknown ref) so they stop retrying.
 */
@Controller({ path: "payments/webhook" })
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(private readonly payments: PaymentsService) {}

  @Post(":provider")
  @HttpCode(HttpStatus.OK)
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
