import { Button, Heading, Section, Text } from "@react-email/components";
import { BrandShell } from "./_layout/BrandShell";
import { tokens } from "./_layout/tokens";
import type { BookingConfirmedHostData } from "../emails.types";

/**
 * Email sent to the host when a customer pays and their booking flips to
 * confirmed. Includes the booking code, customer contact, service list,
 * scheduled time, and net-to-host after the platform fee.
 *
 * `PreviewProps` powers `react-email` dev preview (pnpm email:dev) — ignored
 * at runtime; EmailsService always passes real data.
 */
export default function BookingConfirmedHostTemplate({
  data,
}: {
  data: BookingConfirmedHostData;
}) {
  const {
    hostDisplayName,
    customerName,
    customerPhone,
    customerEmail,
    services,
    slotStartAt,
    amountKobo,
    netToHostKobo,
    bookingCode,
    manageBookingUrl,
  } = data;

  return (
    <BrandShell
      preview={`New booking · ${customerName} · ${formatNaira(amountKobo)}`}
    >
      <Heading style={styles.h1}>You've got a new booking, {hostDisplayName}!</Heading>
      <Text style={styles.p}>
        <strong>{customerName}</strong> just booked and paid. Here's the summary:
      </Text>

      <Section style={styles.card}>
        <Row label="Booking code" value={bookingCode} mono />
        <Row label="Customer" value={customerName} />
        <Row label="Phone" value={customerPhone} />
        <Row label="Email" value={customerEmail} />
        <Row label="When" value={slotStartAt ? formatDate(slotStartAt) : "Not scheduled"} />
        <Row
          label="Services"
          value={services.map((s) => s.title).join(", ") || "—"}
        />
        <Row label="Customer paid" value={formatNaira(amountKobo)} />
        <Row label="Your net (after fee)" value={formatNaira(netToHostKobo)} bold />
      </Section>

      <Section style={styles.ctaSection}>
        <Button href={manageBookingUrl} style={styles.button}>
          View booking
        </Button>
      </Section>
    </BrandShell>
  );
}

export const subject = (data: BookingConfirmedHostData) =>
  `New booking · ${data.customerName} · ${formatNaira(data.amountKobo)}`;

BookingConfirmedHostTemplate.PreviewProps = {
  data: {
    hostDisplayName: "Ada",
    customerName: "Aisha Bello",
    customerPhone: "+2348012345678",
    customerEmail: "aisha@example.com",
    services: [
      { title: "Hydrating Facial", priceKobo: 1_200_000, durationMinutes: 45 },
      { title: "Women's Haircut & Blow Dry", priceKobo: 1_000_000, durationMinutes: 50 },
      { title: "Classic Manicure", priceKobo: 500_000, durationMinutes: 30 },
    ],
    slotStartAt: "2026-07-20T11:00:00.000Z",
    amountKobo: 2_700_000,
    netToHostKobo: 2_632_500,
    bookingCode: "X8-GAFJ",
    manageBookingUrl: "http://localhost:5173/dashboard/bookings",
  },
} satisfies { data: BookingConfirmedHostData };

// ─── helpers ──────────────────────────────────────────────────────────

function Row({
  label,
  value,
  mono,
  bold,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <Text style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span
        style={{
          ...styles.rowValue,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          fontWeight: bold ? 600 : 400,
        }}
      >
        {value}
      </span>
    </Text>
  );
}

function formatNaira(kobo: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(kobo / 100);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const styles = {
  h1: {
    color: tokens.text,
    fontSize: 22,
    fontWeight: 600,
    lineHeight: 1.3,
    margin: "0 0 12px",
  } as const,
  p: {
    color: tokens.text,
    fontSize: 14,
    lineHeight: 1.6,
    margin: "0 0 20px",
  } as const,
  card: {
    backgroundColor: "#fafafa",
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    padding: "16px 20px",
    margin: "0 0 24px",
  } as const,
  row: {
    display: "block",
    fontSize: 14,
    lineHeight: 1.6,
    margin: "6px 0",
  } as const,
  rowLabel: {
    display: "inline-block",
    minWidth: 160,
    color: tokens.mutedText,
  } as const,
  rowValue: {
    color: tokens.text,
  } as const,
  ctaSection: {
    textAlign: "center" as const,
    padding: "8px 0 4px",
  },
  button: {
    backgroundColor: tokens.primary,
    color: tokens.primaryText,
    borderRadius: 999,
    padding: "12px 24px",
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
  } as const,
};
