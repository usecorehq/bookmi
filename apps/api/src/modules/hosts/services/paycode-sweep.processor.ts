import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { QUEUE_PAYCODE_SWEEP } from "../../../common/queues/queue.constants";
import { PaycodeService } from "./paycode.service";

/**
 * Consumer for the 5-minute paycode expiry sweep. Runs in whichever
 * container is registered against the queue — today that's the same
 * process as the producer (single-role deploy), same as `EmailsProcessor`.
 */
@Processor(QUEUE_PAYCODE_SWEEP)
export class PaycodeSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(PaycodeSweepProcessor.name);

  constructor(private readonly paycodes: PaycodeService) {
    super();
  }

  async process(): Promise<void> {
    const count = await this.paycodes.reconcileAllExpiredPaycodes();
    if (count) {
      this.logger.log(`Sweep reconciled ${count} expired paycode(s).`);
    }
  }
}
