import { describe, expect, it } from "vitest";
import { factsBlock, MAX_FACTS_CHARS, QUALIFICATION_RULE } from "./facts";

describe("factsBlock", () => {
  it("is empty when there are no facts", () => {
    expect(factsBlock("")).toBe("");
    expect(factsBlock("   \n ")).toBe("");
    expect(factsBlock(undefined)).toBe("");
    expect(factsBlock(null)).toBe("");
  });

  it("wraps the facts with an override instruction", () => {
    const block = factsBlock("  Degree completed with Distinction.  ");
    expect(block).toMatch(/^CANDIDATE FACTS/);
    expect(block).toMatch(/override/);
    expect(block.endsWith("Degree completed with Distinction.")).toBe(true);
  });

  it("caps very long text", () => {
    const block = factsBlock("x".repeat(MAX_FACTS_CHARS + 500));
    expect(block.split("\n")[1]).toHaveLength(MAX_FACTS_CHARS);
  });
});

describe("QUALIFICATION_RULE", () => {
  it("forbids describing completed study as ongoing", () => {
    expect(QUALIFICATION_RULE).toMatch(/COMPLETED/);
    expect(QUALIFICATION_RULE).toMatch(/currently studying/);
  });
});
