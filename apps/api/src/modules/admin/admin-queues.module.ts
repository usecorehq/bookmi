import { Module } from "@nestjs/common";
import { BullBoardModule } from "@bull-board/nestjs";
import { ExpressAdapter } from "@bull-board/express";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_EMAILS } from "../../common/queues/queue.constants";

/**
 * Bull Board admin UI mounted at `/api/admin/queues`.
 *
 * Read-only view of jobs, retries, and failures — useful when an email
 * won't send or the queue is backed up.
 *
 * `@bull-board/nestjs` mounts a raw Express router that bypasses Nest's
 * guard pipeline, so this route is protected by an HTTP Basic Auth
 * middleware installed in `main.ts` (see `createBullBoardBasicAuthMiddleware`).
 * Set `BULL_BOARD_USER` + `BULL_BOARD_PASS` env vars to enable it; if either
 * is empty, the route is refused entirely.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_EMAILS }),
    BullBoardModule.forRoot({
      route: "/api/admin/queues",
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: QUEUE_EMAILS,
      adapter: BullMQAdapter,
    }),
  ],
})
export class AdminQueuesModule {}
