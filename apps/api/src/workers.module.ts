import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { EmailsModule } from "./modules/emails/emails.module";
import { EmailsProcessor } from "./modules/emails/emails.processor";
import { HostsModule } from "./modules/hosts/hosts.module";
import { PaycodeSweepProcessor } from "./modules/hosts/services/paycode-sweep.processor";
import { PaycodeSweepScheduler } from "./modules/hosts/services/paycode-sweep.scheduler";
import {
  QUEUE_EMAILS,
  QUEUE_PAYCODE_SWEEP,
} from "./common/queues/queue.constants";

/**
 * Processors + schedulers — only wired in `WorkerModule`, i.e. only run in
 * the worker container. Producers (`EmailsService`, `PaycodeService`) stay
 * in their feature modules so HTTP handlers in the web container can enqueue
 * jobs; the `@Processor` classes here consume them.
 *
 * Queues are re-registered locally so the workers own their own DI-scoped
 * queue clients (mirrors qore-backend's WorkersModule pattern). BullMQ
 * queues are stateless Redis clients — multiple registrations pointing at
 * the same queue name are safe.
 *
 * `PaycodeSweepScheduler` lives here (not in `HostsModule`) so the
 * `queue.add({ repeat })` runs once, in the worker. BullMQ dedupes
 * repeatable jobs by `jobId` so running it in both roles is idempotent —
 * this is scoping, not correctness.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_EMAILS }),
    BullModule.registerQueue({ name: QUEUE_PAYCODE_SWEEP }),
    EmailsModule,
    HostsModule,
  ],
  providers: [EmailsProcessor, PaycodeSweepProcessor, PaycodeSweepScheduler],
})
export class WorkersModule {}
