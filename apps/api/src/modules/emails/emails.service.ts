import { Inject, Injectable, Logger } from "@nestjs/common";
import { render } from "@react-email/render";
import type { EmailJob } from "./emails.types";
import { EMAIL_PROVIDER, type EmailProvider } from "./providers/email-provider.interface";
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
 * Producer + render orchestration. Callers hand us a discriminated `EmailJob`,
 * we render the matching template, compute the subject, and pass a normalized
 * `{to, subject, html}` payload to the injected provider.
 *
 * Inline for the hackathon — no BullMQ. Wrap calls in try/catch upstream so a
 * transient SMTP outage doesn't unwind whatever domain action produced the
 * email (settled payment, confirmed booking).
 *
 * Adding a new email:
 *   1. Add a `kind` to `EmailJob` in emails.types.ts
 *   2. Add a `case` in `send()` below
 *   3. Add a template with default export + `subject()` + `PreviewProps`
 */
@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);

  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  async send(job: EmailJob): Promise<void> {
    const rendered = await this.renderJob(job);
    await this.provider.send({ to: job.to, ...rendered });
    this.logger.log(`Sent ${job.kind} to ${job.to}`);
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
        // TS exhaustiveness — if a new kind is added and not handled here,
        // the compiler flags this line.
        const _exhaustive: never = job;
        throw new Error(`Unhandled email kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
