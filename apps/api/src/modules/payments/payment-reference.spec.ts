import {
  buildPaymentReference,
  environmentFromReference,
  referenceId,
} from "./payment-reference";

describe("payment-reference", () => {
  it("prod references are bare, non-prod carry their env prefix", () => {
    expect(buildPaymentReference("prod", "abc")).toBe("bookmi_pmt_abc");
    expect(buildPaymentReference("dev", "abc")).toBe("dev-bookmi_pmt_abc");
    expect(buildPaymentReference("staging", "abc")).toBe("staging-bookmi_pmt_abc");
    expect(buildPaymentReference("sandbox", "abc")).toBe("sandbox-bookmi_pmt_abc");
  });

  it("round-trips the environment through the reference", () => {
    for (const env of ["dev", "staging", "sandbox", "prod"] as const) {
      expect(environmentFromReference(buildPaymentReference(env))).toBe(env);
    }
  });

  it("treats bare, legacy, and unrecognized references as prod", () => {
    expect(environmentFromReference("bookmi_pmt_legacy123")).toBe("prod");
    expect(environmentFromReference("devxxx-not-a-prefix")).toBe("prod");
    expect(environmentFromReference("")).toBe("prod");
  });

  it("generates 20-char lowercase alphanumeric ids", () => {
    const id = referenceId();
    expect(id).toMatch(/^[0-9a-z]{20}$/);
    expect(referenceId()).not.toBe(id);
  });
});
