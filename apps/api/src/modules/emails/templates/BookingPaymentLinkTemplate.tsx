import { Button, Heading, Section, Text } from "@react-email/components";
import { BrandShell } from "./_layout/BrandShell";
import { tokens } from "./_layout/tokens";
import type { BookingPaymentLinkData } from "../emails.types";

/**
 * Email sent to a customer when a host clicks "Send payment link" on a
 * pending booking. Contains a `/pay/:bookingId` link that resumes the exact
 * pending booking — no new row is created, and on successful payment the
 * existing booking flips to confirmed.
 *
 * Deliberately mirrors BookingConfirmedCustomerTemplate.tsx so the two
 * transactional touches feel like the same brand voice.
 */
export default function BookingPaymentLinkTemplate({
  data,
}: {
  data: BookingPaymentLinkData;
}) {
  const {
    customerName,
    hostDisplayName,
    serviceTitle,
    amountKobo,
    bookingCode,
    slotStartAt,
    payUrl,
  } = data;

  return (
    <BrandShell
      preview={`Complete your ${formatNaira(amountKobo)} booking — payment link enclosed`}
    >
      <Heading style={styles.h1}>Finish your booking with {hostDisplayName}</Heading>
      <Text style={styles.p}>
        Hi {customerName}, your booking with <strong>{hostDisplayName}</strong> is
        still pending payment. Tap the button below to complete it — it only
        takes a minute.
      </Text>

      <Section style={styles.card}>
        <Row label="Service" value={serviceTitle} />
        <Row label="When" value={slotStartAt ? formatDate(slotStartAt) : "TBD"} />
        <Row label="Amount due" value={formatNaira(amountKobo)} bold />
        <Row label="Booking code" value={bookingCode} mono />
      </Section>

      <Section style={styles.ctaSection}>
        <Button href={payUrl} style={styles.button}>
          Pay now
        </Button>
      </Section>

      <Text style={styles.fallback}>
        Or copy this URL into your browser:
        <br />
        <span style={styles.fallbackUrl}>{payUrl}</span>
      </Text>
    </BrandShell>
  );
}

export const subject = (data: BookingPaymentLinkData) =>
  `Finish your booking with ${data.hostDisplayName}`;

BookingPaymentLinkTemplate.PreviewProps = {
  data: {
    customerName: "Aisha Bello",
    hostDisplayName: "Serenity Demo Spa",
    serviceTitle: "Hydrating Facial",
    amountKobo: 1_200_000,
    bookingCode: "X8-GAFJ",
    slotStartAt: "2026-07-20T11:00:00.000Z",
    payUrl: "http://localhost:5173/pay/00000000-0000-0000-0000-000000000000",
  },
} satisfies { data: BookingPaymentLinkData };

// ─── helpers (kept local so each template file is self-contained) ────

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
    margin: "0 0 20px",
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
    padding: "12px 28px",
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
  } as const,
  fallback: {
    color: tokens.mutedText,
    fontSize: 12,
    lineHeight: 1.6,
    margin: "16px 0 0",
    wordBreak: "break-all" as const,
  } as const,
  fallbackUrl: {
    color: tokens.primary,
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
  } as const,
};
