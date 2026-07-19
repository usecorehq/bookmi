import { canTransition, isTerminal } from "./payment-state";

describe("payment state machine", () => {
  it("allows the happy path pending → processing → success", () => {
    expect(canTransition("pending", "processing")).toBe(true);
    expect(canTransition("processing", "success")).toBe(true);
    expect(canTransition("pending", "success")).toBe(true);
  });

  it("allows pending/processing to fail or abandon", () => {
    expect(canTransition("pending", "failed")).toBe(true);
    expect(canTransition("pending", "abandoned")).toBe(true);
    expect(canTransition("processing", "failed")).toBe(true);
    expect(canTransition("processing", "abandoned")).toBe(true);
  });

  it("only allows success → reversed once settled", () => {
    expect(canTransition("success", "reversed")).toBe(true);
    expect(canTransition("success", "pending")).toBe(false);
    expect(canTransition("success", "failed")).toBe(false);
    expect(canTransition("success", "processing")).toBe(false);
  });

  it("never leaves failure-terminal states", () => {
    for (const from of ["failed", "abandoned", "reversed"] as const) {
      for (const to of ["pending", "processing", "success", "failed", "abandoned"] as const) {
        if (from === to) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("treats same-status as a permitted (no-op) transition", () => {
    expect(canTransition("pending", "pending")).toBe(true);
    expect(canTransition("success", "success")).toBe(true);
  });

  it("classifies terminal statuses (success is settled but not failure-terminal)", () => {
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("abandoned")).toBe(true);
    expect(isTerminal("reversed")).toBe(true);
    expect(isTerminal("success")).toBe(false);
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("processing")).toBe(false);
  });
});
