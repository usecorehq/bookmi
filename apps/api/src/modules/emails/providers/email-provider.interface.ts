/**
 * Provider-agnostic mail send contract. Every provider (SMTP today, Resend
 * HTTP later) implements this. `EmailsService` never speaks provider dialect —
 * it renders the template, then hands the payload here.
 */
export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export interface EmailProvider {
  send(payload: EmailPayload): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
