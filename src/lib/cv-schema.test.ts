import { describe, it, expect } from "vitest";
import {
  cvForPrompt,
  mergeWithMaster,
  neverClaimInstruction,
  parseNeverClaim,
  type CvContent,
} from "./cv-schema";

const master: CvContent = {
  full_name: "Conor Bourke",
  contact_line: "conor@example.com",
  role_title: "Operations Manager",
  about_me: "Master about me.",
  experience: [
    {
      company: "Acme Ltd",
      dates: "Jan 2020 – Mar 2023",
      role_title: "Ops Lead",
      responsibilities: ["Ran the warehouse"],
    },
  ],
  licenses: ["Forklift licence"],
  education: [
    { institution: "Uni of Life", qualification: "BSc", dates: "2016 – 2019" },
  ],
};

describe("mergeWithMaster — fixed slots are inherited, variable slots tailored", () => {
  it("never lets a role template change company, dates or education", () => {
    const merged = mergeWithMaster(master, {
      role_title: "Logistics Director",
      about_me: "Tailored summary for a logistics role.",
      licenses: ["Forklift licence", "HGV"],
      experience_overrides: [
        { role_title: "Logistics Lead", responsibilities: ["Optimised routing"] },
      ],
    });

    // Fixed — straight from the master.
    expect(merged.full_name).toBe("Conor Bourke");
    expect(merged.contact_line).toBe("conor@example.com");
    expect(merged.experience[0].company).toBe("Acme Ltd");
    expect(merged.experience[0].dates).toBe("Jan 2020 – Mar 2023");
    expect(merged.education).toEqual(master.education);

    // Variable — taken from the override.
    expect(merged.role_title).toBe("Logistics Director");
    expect(merged.about_me).toBe("Tailored summary for a logistics role.");
    expect(merged.licenses).toEqual(["Forklift licence", "HGV"]);
    expect(merged.experience[0].role_title).toBe("Logistics Lead");
    expect(merged.experience[0].responsibilities).toEqual(["Optimised routing"]);
  });

  it("falls back to master values when no override is supplied", () => {
    const merged = mergeWithMaster(master, {});
    expect(merged).toEqual(master);
  });

  it("keeps experience array length and order aligned to the master", () => {
    const merged = mergeWithMaster(master, {
      experience_overrides: [{ responsibilities: ["only responsibilities changed"] }],
    });
    expect(merged.experience).toHaveLength(1);
    expect(merged.experience[0].company).toBe("Acme Ltd");
    expect(merged.experience[0].role_title).toBe("Ops Lead"); // not overridden → master
    expect(merged.experience[0].responsibilities).toEqual(["only responsibilities changed"]);
  });
});

describe("never_claim — forbidden claims stay out of CVs and become a hard rule", () => {
  const withNever: CvContent = {
    ...master,
    never_claim: "Built an admin system for Acme Ltd\n\n  - Led a team of 10  \n",
  };

  it("parses one claim per line, dropping blanks and bullet markers", () => {
    expect(parseNeverClaim(withNever.never_claim)).toEqual([
      "Built an admin system for Acme Ltd",
      "Led a team of 10",
    ]);
    expect(parseNeverClaim(undefined)).toEqual([]);
  });

  it("is never copied into tailored or role-template content", () => {
    expect(mergeWithMaster(withNever, {})).not.toHaveProperty("never_claim");
  });

  it("is stripped from the CV data the AI sees", () => {
    const forPrompt = cvForPrompt(withNever);
    expect(forPrompt).not.toHaveProperty("never_claim");
    expect(JSON.stringify(forPrompt)).not.toContain("admin system");
  });

  it("produces a hard rule listing every claim, or nothing when empty", () => {
    const rule = neverClaimInstruction(withNever.never_claim);
    expect(rule).toContain("- Built an admin system for Acme Ltd");
    expect(rule).toContain("- Led a team of 10");
    expect(neverClaimInstruction("  \n ")).toBe("");
  });
});
