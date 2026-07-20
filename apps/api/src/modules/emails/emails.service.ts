import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { QUEUE_EMAILS } from "../../common/queues/queue.constants";
import type { EmailJob } from "./emails.types";

/**
 * Producer. Any code path that wants to send email — HTTP handlers, purpose
 * handlers, cron services — injects this and calls `enqueue()`. The
 * `EmailsProcessor` in this same module renders the template and speaks to
 * the transport (SMTP by default).
 *
 * Retry policy: 5 attempts with exponential backoff starting at 10s. That
 * covers transient SMTP outages, network blips, and Resend/SES rate limits
 * without a queue outage taking down whatever domain action triggered the
 * email (settled payment, confirmed booking).
 *
 * `jobId` gives producer-side dedup — pass the same key from two paths and
 * BullMQ drops the second. Useful for renewal receipts, reminders, etc.
 */
@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);

  constructor(
    @InjectQueue(QUEUE_EMAILS) private readonly queue: Queue<EmailJob>,
  ) {}

  async enqueue(
    job: EmailJob,
    opts?: { jobId?: string; delay?: number },
  ): Promise<void> {
    await this.queue.add(job.kind, job, {
      jobId: opts?.jobId,
      delay: opts?.delay,
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
    });
    this.logger.debug?.(`Enqueued email ${job.kind} → ${job.to}`);
  }
}
