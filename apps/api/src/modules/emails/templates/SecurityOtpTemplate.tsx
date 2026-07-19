import { Heading, Text } from "@react-email/components";
import { BrandShell } from "./_layout/BrandShell";
import { tokens } from "./_layout/tokens";
import type { SecurityOtpData } from "../emails.types";

export const subject = (data: SecurityOtpData) =>
  `Confirm your Bookmi ${data.purposeLabel}`;

interface Props {
  data: SecurityOtpData;
}

/**
 * OTP challenge for money-out operations. Mirrors ResetPasswordTemplate so
 * the two share the same "code in a box" visual pattern.
 *
 * The `purposeLabel` ("refund" or "withdrawal") is baked into the heading
 * and the disclaimer — so the user can spot a mismatched action ("wait, I
 * didn't request a refund") before typing the code.
 */
export default function SecurityOtpTemplate({ data }: Props) {
  return (
    <BrandShell preview={`Your ${data.purposeLabel} verification code`}>
      <Heading style={{ fontSize: 20, fontWeight: "bold", margin: "16px 0", color: tokens.text }}>
        Confirm your {data.purposeLabel} with this code
      </Heading>
      <Text style={{ fontSize: 16, lineHeight: 1.5, color: tokens.text }}>
        Enter the 6-digit code below in your Bookmi dashboard to authorize the {data.purposeLabel}.
      </Text>

      {/* Verification Code Block */}
      <div style={styles.codeContainer}>
        <Text style={styles.codeText}>{data.code}</Text>
      </div>

      <Text style={{ fontSize: 14, lineHeight: 1.5, color: tokens.mutedText, marginTop: 24 }}>
        This code expires in {data.expiresInMinutes} minutes.
      </Text>

      <Text style={{ fontSize: 12, color: tokens.mutedText, marginTop: 24 }}>
        You're seeing this because someone (hopefully you) tried to authorize a
        payout or refund on your Bookmi account. If not, ignore this email and
        reset your password.
      </Text>
    </BrandShell>
  );
}

const styles = {
  codeContainer: {
    backgroundColor: tokens.background,
    borderRadius: 8,
    border: `1px solid ${tokens.border}`,
    padding: "16px",
    margin: "24px 0",
    textAlign: "center" as const,
  },
  codeText: {
    fontSize: 32,
    fontWeight: "bold",
    letterSpacing: "4px",
    color: tokens.primary,
    margin: 0,
    fontFamily: "monospace",
  },
};

SecurityOtpTemplate.PreviewProps = {
  data: {
    code: "482910",
    purpose: "withdraw_funds",
    purposeLabel: "withdrawal",
    expiresInMinutes: 5,
  },
} satisfies { data: SecurityOtpData };
