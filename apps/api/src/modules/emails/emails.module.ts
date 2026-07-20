import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MailerModule } from "@nestjs-modules/mailer";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_EMAILS } from "../../common/queues/queue.constants";
import { EmailsService } from "./emails.service";
import { EmailsProcessor } from "./emails.processor";
import { EMAIL_PROVIDER } from "./providers/email-provider.interface";
import { SmtpProvider } from "./providers/smtp.provider";

/**
 * Email queue + producer + processor.
 *
 * `EmailsService` is exported so any module can enqueue jobs — HTTP handlers,
 * cron services, purpose handlers. The `EmailsProcessor` is bound to the same
 * `QUEUE_EMAILS` and renders the template + speaks to the transport.
 *
 * Today producer + processor run in the same process. When we split web +
 * worker deploys (see qore-backend's WorkersModule + APP_ROLE pattern), only
 * the `@Processor` class moves — the producer stays put.
 *
 * Transport is SMTP via `@nestjs-modules/mailer`, behind the `EmailProvider`
 * interface. Swapping to Resend/SES/SendGrid later is a one-file change:
 * add a new provider class and swap the `EMAIL_PROVIDER` alias.
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_EMAILS }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.getOrThrow<string>("mailer.host"),
          port: config.getOrThrow<number>("mailer.port"),
          secure: config.get<boolean>("mailer.secure") ?? false,
          auth: config.get<string>("mailer.user")
            ? {
                user: config.get<string>("mailer.user"),
                pass: config.get<string>("mailer.pass"),
              }
            : undefined,
        },
        defaults: {
          from: `${config.getOrThrow<string>(
            "mailer.fromName",
          )} <${config.getOrThrow<string>("mailer.fromAddress")}>`,
        },
      }),
    }),
  ],
  providers: [
    EmailsService,
    EmailsProcessor,
    SmtpProvider,
    { provide: EMAIL_PROVIDER, useExisting: SmtpProvider },
  ],
  exports: [EmailsService, BullModule, EMAIL_PROVIDER],
})
export class EmailsModule {}
