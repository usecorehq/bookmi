import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PURPOSE_HANDLERS,
  type PaymentPurposeHandler,
} from "./purpose-handler.interface";

@Injectable()
export class PurposeHandlerRegistry {
  private readonly byType: Map<string, PaymentPurposeHandler>;

  constructor(@Inject(PAYMENT_PURPOSE_HANDLERS) handlers: PaymentPurposeHandler[]) {
    this.byType = new Map(handlers.map((h) => [h.purposeType, h]));
  }

  get(purposeType: string): PaymentPurposeHandler {
    const h = this.byType.get(purposeType);
    if (!h) throw new BadRequestException(`Unknown payment purpose: ${purposeType}`);
    return h;
  }

  all(): PaymentPurposeHandler[] {
    return [...this.byType.values()];
  }
}
