import { Button, Heading, Text } from "@react-email/components";
import { BrandShell } from "./_layout/BrandShell";
import { tokens } from "./_layout/tokens";

export const subject = () => "Confirm your email address";

interface Props {
  data: {
    email: string;
    code: string;
    verifyUrl: string;
  };
}

export default function ConfirmEmailTemplate({ data }: Props) {
  return (
    <BrandShell preview="Confirm your email address">
      <Heading style={{ fontSize: 20, fontWeight: "bold", margin: "16px 0", color: tokens.text }}>
        Confirm Your Email
      </Heading>
      <Text style={{ fontSize: 16, lineHeight: 1.5, color: tokens.text }}>
        Thanks for signing up for Bookmi! Please use the verification code below to confirm your email:
      </Text>
      
      {/* Verification Code Block */}
      <div style={styles.codeContainer}>
        <Text style={styles.codeText}>{data.code}</Text>
      </div>

      <Text style={{ fontSize: 14, lineHeight: 1.5, color: tokens.mutedText, marginTop: 24 }}>
        Alternatively, you can confirm your email by clicking the button below:
      </Text>

      <Button href={data.verifyUrl} style={styles.button}>
        Confirm Email Address
      </Button>

      <Text style={{ fontSize: 12, color: tokens.mutedText, marginTop: 24 }}>
        If you did not request this email, you can safely ignore it.
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
  button: {
    backgroundColor: tokens.primary,
    color: tokens.primaryText,
    padding: "12px 24px",
    borderRadius: 6,
    textDecoration: "none",
    textAlign: "center" as const,
    display: "inline-block",
    fontWeight: "bold",
    marginTop: 12,
  },
};

ConfirmEmailTemplate.PreviewProps = {
  data: {
    email: "aisha@example.com",
    code: "143843",
    verifyUrl: "http://localhost:8000/auth/v1/verify?token=mock_hash&type=signup&redirect_to=http%3A%2F%2Flocalhost%3A5173",
  },
} satisfies { data: { email: string; code: string; verifyUrl: string } };
