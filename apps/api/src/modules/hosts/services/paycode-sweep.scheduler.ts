import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_PAYCODE_SWEEP } from "../../../common/queues/queue.constants";

const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Enqueues the paycode expiry sweep as a BullMQ *repeatable* job on every
 * process boot. BullMQ dedupes repeatable jobs by (name, repeat options,
 * jobId), so re-adding it on every boot is a no-op, not a duplicate
 * schedule — same "call it every time, it's idempotent" posture as
 * `HostWalletService.activateReservedAccount`'s provisioning.
 *
 * No new scheduling dependency — reuses the BullMQ/Redis infra already
 * wired for the email queue (`apps/api/src/common/queues/`).
 */
@Injectable()
export class PaycodeSweepScheduler implements OnModuleInit {
  private readonly logger = new Logger(PaycodeSweepScheduler.name);

  constructor(@InjectQueue(QUEUE_PAYCODE_SWEEP) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      "sweep",
      {},
      {
        repeat: { every: SWEEP_INTERVAL_MS },
        jobId: "paycode-expiry-sweep",
      },
    );
    this.logger.log(`Paycode expiry sweep scheduled every ${SWEEP_INTERVAL_MS / 60_000} minutes.`);
  }
}
