import { EmailsService } from "./emails.service";
import type { EmailPayload, EmailProvider } from "./providers/email-provider.interface";
import type {
  BookingConfirmedCustomerData,
  BookingConfirmedHostData,
} from "./emails.types";

/**
 * qore-backend doesn't have this — its spec only mocks the queue and asserts
 * enqueue shape. Since we render inline (no queue), the render step IS the
 * hot path, so we assert both provider payload + rendered HTML contents.
 */

class RecordingProvider implements EmailProvider {
  sent: EmailPayload[] = [];
  async send(payload: EmailPayload): Promise<void> {
    this.sent.push(payload);
  }
}

const HOST_DATA: BookingConfirmedHostData = {
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
};

const CUSTOMER_DATA: BookingConfirmedCustomerData = {
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
};

describe("EmailsService", () => {
  it("renders booking_confirmed_host with all key strings + fires provider once", async () => {
    const provider = new RecordingProvider();
    const service = new EmailsService(provider);

    await service.send({
      kind: "booking_confirmed_host",
      to: "ada@example.com",
      data: HOST_DATA,
    });

    expect(provider.sent).toHaveLength(1);
    const [payload] = provider.sent;
    expect(payload!.to).toBe("ada@example.com");
    expect(payload!.subject).toContain("Aisha Bello");
    expect(payload!.subject).toContain("New booking");

    // Rendered HTML must carry every load-bearing field.
    expect(payload!.html).toContain("Ada");
    expect(payload!.html).toContain("Aisha Bello");
    expect(payload!.html).toContain("+2348012345678");
    expect(payload!.html).toContain("aisha@example.com");
    expect(payload!.html).toContain("X8-GAFJ");
    expect(payload!.html).toContain("Hydrating Facial");
    expect(payload!.html).toContain("Classic Manicure");
    expect(payload!.html).toContain("View booking");
    expect(payload!.html).toContain("http://localhost:5173/dashboard/bookings");
    // BrandShell chrome present.
    expect(payload!.html).toContain("Powered by Qorelly");
  });

  it("renders booking_confirmed_customer with the code prominently + host contact", async () => {
    const provider = new RecordingProvider();
    const service = new EmailsService(provider);

    await service.send({
      kind: "booking_confirmed_customer",
      to: "aisha@example.com",
      data: CUSTOMER_DATA,
    });

    const [payload] = provider.sent;
    expect(payload!.subject).toContain("Serenity Demo Spa");
    expect(payload!.subject).toContain("X8-GAFJ");

    expect(payload!.html).toContain("Aisha Bello");
    expect(payload!.html).toContain("Serenity Demo Spa");
    expect(payload!.html).toContain("X8-GAFJ");
    expect(payload!.html).toContain("+2348012345678");
    expect(payload!.html).toContain("123 Opebi Road, Ikeja, Lagos");
    expect(payload!.html).toContain("Hydrating Facial");
    // React 19 inserts `<!-- -->` between adjacent text nodes; check the CTA
    // by its target instead of a fragile "View <name>" substring.
    expect(payload!.html).toContain("http://localhost:5173/serenity-demo-spa");
    expect(payload!.html).toMatch(/View <!-- -->Serenity Demo Spa/);
  });

  it("bubbles provider errors so callers can wrap in try/catch", async () => {
    const failingProvider: EmailProvider = {
      send: async () => {
        throw new Error("SMTP down");
      },
    };
    const service = new EmailsService(failingProvider);

    await expect(
      service.send({
        kind: "booking_confirmed_host",
        to: "ada@example.com",
        data: HOST_DATA,
      }),
    ).rejects.toThrow("SMTP down");
  });
});
