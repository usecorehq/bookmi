import { Button, Heading, Section, Text } from "@react-email/components";
import { BrandShell } from "./_layout/BrandShell";
import { tokens } from "./_layout/tokens";
import type { BookingConfirmedCustomerData } from "../emails.types";

/**
 * Email sent to the paying customer once the booking is confirmed. Shows
 * the booking code (they can quote it if they call the host), the host's
 * contact details, and the scheduled service list + slot.
 */
export default function BookingConfirmedCustomerTemplate({
  data,
}: {
  data: BookingConfirmedCustomerData;
}) {
  const {
    customerName,
    hostDisplayName,
    hostPhone,
    hostAddress,
    services,
    slotStartAt,
    amountKobo,
    bookingCode,
    publicPageUrl,
  } = data;

  return (
    <BrandShell preview={`Your booking with ${hostDisplayName} is confirmed`}>
      <Heading style={styles.h1}>You're booked, {customerName}!</Heading>
      <Text style={styles.p}>
        Thanks for choosing <strong>{hostDisplayName}</strong>. Here's what you booked:
      </Text>

      <Section style={styles.codeCard}>
        <Text style={styles.codeLabel}>YOUR BOOKING CODE</Text>
        <Text style={styles.code}>{bookingCode}</Text>
        <Text style={styles.codeHint}>
          Save this. Quote it if you call to reschedule.
        </Text>
      </Section>

      <Section style={styles.card}>
        <Row label="When" value={slotStartAt ? formatDate(slotStartAt) : "TBD"} />
        <Row
          label="Services"
          value={services.map((s) => s.title).join(", ") || "—"}
        />
        <Row label="Amount paid" value={formatNaira(amountKobo)} bold />
      </Section>

      <Section style={styles.card}>
        <Row label={`${hostDisplayName}'s phone`} value={hostPhone ?? "—"} />
        <Row label="Address" value={hostAddress ?? "—"} />
      </Section>

      <Section style={styles.ctaSection}>
        <Button href={publicPageUrl} style={styles.button}>
          View {hostDisplayName}'s page
        </Button>
      </Section>
    </BrandShell>
  );
}

export const subject = (data: BookingConfirmedCustomerData) =>
  `Your booking with ${data.hostDisplayName} is confirmed (${data.bookingCode})`;

BookingConfirmedCustomerTemplate.PreviewProps = {
  data: {
    customerName: "Aisha Bello",
    hostDisplayName: "Serenity Demo Spa",
    hostSlug: "serenity-demo-spa",
    hostPhone: "+2348012345678",
    hostAddress: "123 Opebi Road, Ikeja, Lagos",
    services: [
      { title: "Hydrating Facial", priceKobo: 1_200_000, durationMinutes: 45 },
      { title: "Women's Haircut & Blow Dry", priceKobo: 1_000_000, durationMinutes: 50 },
      { title: "Classic Manicure", priceKobo: 500_000, durationMinutes: 30 },
    ],
    slotStartAt: "2026-07-20T11:00:00.000Z",
    amountKobo: 2_700_000,
    bookingCode: "X8-GAFJ",
    publicPageUrl: "http://localhost:5173/serenity-demo-spa",
  },
} satisfies { data: BookingConfirmedCustomerData };

// ─── helpers (kept local so each template file is self-contained) ────

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <Text style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={{ ...styles.rowValue, fontWeight: bold ? 600 : 400 }}>{value}</span>
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
  codeCard: {
    backgroundColor: "#f5f3ff",
    border: `1px solid ${tokens.primary}`,
    borderRadius: 12,
    padding: "20px",
    textAlign: "center" as const,
    margin: "0 0 20px",
  },
  codeLabel: {
    color: tokens.mutedText,
    fontSize: 11,
    letterSpacing: "0.08em",
    margin: "0 0 8px",
  } as const,
  code: {
    color: tokens.primary,
    fontFamily: "ui-monospace, 'Menlo', monospace",
    fontSize: 36,
    fontWeight: 700,
    letterSpacing: "0.05em",
    margin: 0,
  } as const,
  codeHint: {
    color: tokens.mutedText,
    fontSize: 12,
    margin: "8px 0 0",
  } as const,
  card: {
    backgroundColor: "#fafafa",
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    padding: "16px 20px",
    margin: "0 0 16px",
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
