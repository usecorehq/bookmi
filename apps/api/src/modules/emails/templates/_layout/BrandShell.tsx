import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { tokens } from "./tokens";

/**
 * Shared chrome for every Bookmi email. Wraps content in the standard
 * `<Html><Head/><Body>` + centered container + logo header + "Powered by
 * Qorelly" footer. Templates render their body inside `<BrandShell>`.
 */
interface Props {
  preview: string;
  children: React.ReactNode;
}

export function BrandShell({ preview, children }: Props) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.headerSection}>
            <Img
              src={tokens.logoUrl}
              alt="Bookmi"
              width={120}
              height={40}
              style={styles.logo}
            />
          </Section>
          <Hr style={styles.hr} />
          <Section style={styles.contentSection}>{children}</Section>
          <Hr style={styles.hr} />
          <Section style={styles.footerSection}>
            <Text style={styles.footerText}>
              Powered by Qorelly · Bookmi is a booking service for creators and pros.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    backgroundColor: tokens.background,
    fontFamily: tokens.fontFamily,
    margin: 0,
    padding: "24px 12px",
    color: tokens.text,
  } as const,
  container: {
    backgroundColor: tokens.container,
    borderRadius: tokens.radius,
    maxWidth: tokens.containerMaxWidth,
    margin: "0 auto",
    padding: "32px 32px 24px",
  } as const,
  headerSection: {
    textAlign: "left" as const,
    paddingBottom: 12,
  },
  logo: {
    borderRadius: 8,
  } as const,
  hr: {
    borderColor: tokens.border,
    borderStyle: "solid" as const,
    borderWidth: "1px 0 0 0",
    margin: "8px 0",
  },
  contentSection: {
    padding: "16px 0",
  } as const,
  footerSection: {
    paddingTop: 16,
  } as const,
  footerText: {
    color: tokens.mutedText,
    fontSize: 12,
    lineHeight: 1.5,
    margin: 0,
  } as const,
};
