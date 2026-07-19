import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MailerModule } from "@nestjs-modules/mailer";
import { EmailsService } from "./emails.service";
import { EMAIL_PROVIDER } from "./providers/email-provider.interface";
import { SmtpProvider } from "./providers/smtp.provider";

/**
 * Global — any module can `constructor(private readonly emails: EmailsService)`.
 * MailerModule is wired async so the ConfigService is available first.
 *
 * The provider abstraction (EMAIL_PROVIDER token aliased to SmtpProvider)
 * means swapping to a Resend HTTP provider later is one line here.
 */
@Global()
@Module({
  imports: [
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
    SmtpProvider,
    { provide: EMAIL_PROVIDER, useExisting: SmtpProvider },
  ],
  exports: [EmailsService, EMAIL_PROVIDER],
})
export class EmailsModule {}
