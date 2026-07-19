import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MailerService } from "@nestjs-modules/mailer";
import type { EmailPayload, EmailProvider } from "./email-provider.interface";

/**
 * The only concrete provider today. Points at Mailhog in dev
 * (SMTP localhost:1025, web preview localhost:8025), Resend's SMTP relay
 * in prod (or SES / Mailgun — env-swappable, no code change).
 */
@Injectable()
export class SmtpProvider implements EmailProvider {
  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async send(payload: EmailPayload): Promise<void> {
    const fromAddress = this.config.get<string>("mailer.fromAddress")!;
    const fromName = this.config.get<string>("mailer.fromName")!;
    await this.mailer.sendMail({
      from: `${fromName} <${fromAddress}>`,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
  }
}
