import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { render } from "@react-email/render";
import { QUEUE_EMAILS } from "../../common/queues/queue.constants";
import type { EmailJob } from "./emails.types";
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from "./providers/email-provider.interface";
import BookingConfirmedHostTemplate, {
  subject as bookingConfirmedHostSubject,
} from "./templates/BookingConfirmedHostTemplate";
import BookingConfirmedCustomerTemplate, {
  subject as bookingConfirmedCustomerSubject,
} from "./templates/BookingConfirmedCustomerTemplate";
import ResetPasswordTemplate, {
  subject as resetPasswordSubject,
} from "./templates/ResetPasswordTemplate";
import ConfirmEmailTemplate, {
  subject as confirmEmailSubject,
} from "./templates/ConfirmEmailTemplate";

/**
 * Consumer. Runs in whichever container is registered against the queue —
 * today that's the same process as the producer (single-role deploy). When
 * we split web + worker roles (see qore-backend's WorkersModule pattern),
 * move ONLY this @Processor class over; the producer (`EmailsService`) stays
 * where callsites live.
 *
 * BullMQ retries transient failures via the producer's `attempts` +
 * `backoff` config; a genuinely broken payload lands in the failed queue
 * with the exception attached, ready for admin review.
 */
@Processor(QUEUE_EMAILS)
export class EmailsProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailsProcessor.name);

  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { subject, html } = await this.renderJob(job.data);
    await this.provider.send({ to: job.data.to, subject, html });
    this.logger.log(`Sent ${job.data.kind} → ${job.data.to}`);
  }

  private async renderJob(
    job: EmailJob,
  ): Promise<{ subject: string; html: string }> {
    switch (job.kind) {
      case "booking_confirmed_host": {
        const html = await render(BookingConfirmedHostTemplate({ data: job.data }));
        return { subject: bookingConfirmedHostSubject(job.data), html };
      }
      case "booking_confirmed_customer": {
        const html = await render(BookingConfirmedCustomerTemplate({ data: job.data }));
        return { subject: bookingConfirmedCustomerSubject(job.data), html };
      }
      case "reset_password": {
        const html = await render(ResetPasswordTemplate({ data: job.data }));
        return { subject: resetPasswordSubject(), html };
      }
      case "confirm_email": {
        const html = await render(ConfirmEmailTemplate({ data: job.data }));
        return { subject: confirmEmailSubject(), html };
      }
      default: {
        // TS exhaustiveness — adding a new kind without a case fails compile.
        const _exhaustive: never = job;
        throw new Error(`Unhandled email kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
