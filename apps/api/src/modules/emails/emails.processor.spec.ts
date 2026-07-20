import type { Job } from "bullmq";
import { EmailsProcessor } from "./emails.processor";
import type { EmailJob } from "./emails.types";
import type { EmailPayload, EmailProvider } from "./providers/email-provider.interface";

/**
 * Consumer-side spec. Asserts every load-bearing field survives the render
 * step and reaches the provider — cheap insurance since a broken template
 * ships silently in production.
 */

class RecordingProvider implements EmailProvider {
  sent: EmailPayload[] = [];
  async send(payload: EmailPayload): Promise<void> {
    this.sent.push(payload);
  }
}

const HOST_JOB: EmailJob = {
  kind: "booking_confirmed_host",
  to: "ada@example.com",
  data: {
    hostDisplayName: "Ada",
    customerName: "Aisha Bello",
    customerPhone: "+2348012345678",
    customerEmail: "aisha@example.com",
    services: [
      { title: "Hydrating Facial", priceKobo: 1_200_000, durationMinutes: 45 },
      { title: "Classic Manicure", priceKobo: 500_000, durationMinutes: 30 },
    ],
    slotStartAt: "2026-07-20T11:00:00.000Z",
    amountKobo: 1_700_000,
    netToHostKobo: 1_657_500,
    bookingCode: "X8-GAFJ",
    manageBookingUrl: "http://localhost:5173/dashboard/bookings",
  },
};

const CUSTOMER_JOB: EmailJob = {
  kind: "booking_confirmed_customer",
  to: "aisha@example.com",
  data: {
    customerName: "Aisha Bello",
    hostDisplayName: "Serenity Demo Spa",
    hostSlug: "serenity-demo-spa",
    hostPhone: "+2348012345678",
    hostAddress: "123 Opebi Road, Ikeja, Lagos",
    services: [{ title: "Hydrating Facial", priceKobo: 1_200_000, durationMinutes: 45 }],
    slotStartAt: "2026-07-20T11:00:00.000Z",
    amountKobo: 1_200_000,
    bookingCode: "X8-GAFJ",
    publicPageUrl: "http://localhost:5173/serenity-demo-spa",
  },
};

function makeJob<T extends EmailJob>(data: T): Job<T> {
  return { data } as unknown as Job<T>;
}

describe("EmailsProcessor", () => {
  it("renders booking_confirmed_host with every load-bearing field + fires provider once", async () => {
    const provider = new RecordingProvider();
    const processor = new EmailsProcessor(provider);

    await processor.process(makeJob(HOST_JOB));

    expect(provider.sent).toHaveLength(1);
    const [payload] = provider.sent;
    expect(payload!.to).toBe("ada@example.com");
    expect(payload!.subject).toContain("Aisha Bello");
    expect(payload!.subject).toContain("New booking");
    expect(payload!.html).toContain("Ada");
    expect(payload!.html).toContain("Aisha Bello");
    expect(payload!.html).toContain("+2348012345678");
    expect(payload!.html).toContain("aisha@example.com");
    expect(payload!.html).toContain("X8-GAFJ");
    expect(payload!.html).toContain("Hydrating Facial");
    expect(payload!.html).toContain("Classic Manicure");
    expect(payload!.html).toContain("View booking");
    expect(payload!.html).toContain("http://localhost:5173/dashboard/bookings");
    expect(payload!.html).toContain("Powered by Qorelly");
  });

  it("renders booking_confirmed_customer with the code + host contact + CTA", async () => {
    const provider = new RecordingProvider();
    const processor = new EmailsProcessor(provider);

    await processor.process(makeJob(CUSTOMER_JOB));

    const [payload] = provider.sent;
    expect(payload!.subject).toContain("Serenity Demo Spa");
    expect(payload!.subject).toContain("X8-GAFJ");
    expect(payload!.html).toContain("Aisha Bello");
    expect(payload!.html).toContain("Serenity Demo Spa");
    expect(payload!.html).toContain("X8-GAFJ");
    expect(payload!.html).toContain("+2348012345678");
    expect(payload!.html).toContain("123 Opebi Road, Ikeja, Lagos");
    expect(payload!.html).toContain("Hydrating Facial");
    expect(payload!.html).toContain("http://localhost:5173/serenity-demo-spa");
    expect(payload!.html).toMatch(/View <!-- -->Serenity Demo Spa/);
  });

  it("bubbles provider errors so BullMQ retries per the producer's attempts config", async () => {
    const failingProvider: EmailProvider = {
      send: async () => {
        throw new Error("SMTP down");
      },
    };
    const processor = new EmailsProcessor(failingProvider);

    await expect(processor.process(makeJob(HOST_JOB))).rejects.toThrow("SMTP down");
  });
});
