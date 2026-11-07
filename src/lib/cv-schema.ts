/**
 * Structured CV content. The AI only ever fills these slots — it never
 * produces layout. Rendering goes through the shared HTML/CSS → PDF pipeline
 * so a tailored CV is pixel-identical in layout to the master template.
 *
 * Fixed (inherited from master, never altered by role templates or AI):
 *   - experience[].company, experience[].dates
 *   - education
 *   - personal details
 * Variable (per role template / per generation):
 *   - about_me, role_title, experience[].responsibilities, licenses
 * Master-only, never rendered:
 *   - never_claim — things the AI must never say about the candidate
 */

export interface CvExperience {
  company: string; // FIXED
  dates: string; // FIXED, e.g. "Jan 2020 – Mar 2023"
  role_title: string; // variable
  responsibilities: string[]; // variable
}

export interface CvEducation {
  institution: string;
  qualification: string;
  dates: string;
}

export interface CvContent {
  full_name: string;
  contact_line: string; // email · phone · location
  role_title: string; // variable headline title
  about_me: string; // variable
  experience: CvExperience[];
  licenses: string[]; // variable — licenses & qualifications
  education: CvEducation[]; // FIXED
  /**
   * Master only. Free text, one claim per line, that the AI must never make
   * about the candidate (e.g. a system they did not build). Never rendered on
   * the CV and never copied into role templates or generated content.
   */
  never_claim?: string;
}

export const EMPTY_CV: CvContent = {
  full_name: "",
  contact_line: "",
  role_title: "",
  about_me: "",
  experience: [],
  licenses: [],
  education: [],
};

/**
 * Build a role template / AI output from master + variable overrides,
 * structurally enforcing that fixed fields come from the master.
 */
export function mergeWithMaster(
  master: CvContent,
  variable: {
    role_title?: string;
    about_me?: string;
    licenses?: string[];
    experience_overrides?: { role_title?: string; responsibilities?: string[] }[];
  }
): CvContent {
  return {
    full_name: master.full_name,
    contact_line: master.contact_line,
    role_title: variable.role_title ?? master.role_title,
    about_me: variable.about_me ?? master.about_me,
    licenses: variable.licenses ?? master.licenses,
    education: master.education, // always fixed
    experience: master.experience.map((exp, i) => ({
      company: exp.company, // always fixed
      dates: exp.dates, // always fixed
      role_title: variable.experience_overrides?.[i]?.role_title ?? exp.role_title,
      responsibilities:
        variable.experience_overrides?.[i]?.responsibilities ?? exp.responsibilities,
    })),
  };
}

/** Parse the master's never_claim free text into one claim per line. */
export function parseNeverClaim(text: string | undefined | null): string[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*\u2022]\s*/, "").trim())
    .filter(Boolean);
}

/**
 * CV content as the AI should see it: without the never_claim list, so the
 * forbidden claims are never presented as candidate facts. The list is given
 * to the model separately via neverClaimInstruction().
 */
export function cvForPrompt(content: CvContent): Omit<CvContent, "never_claim"> {
  const { never_claim, ...rest } = content;
  return rest;
}

/** Hard prompt rule built from the master's never_claim list ("" if empty). */
export function neverClaimInstruction(text: string | undefined | null): string {
  const claims = parseNeverClaim(text);
  if (!claims.length) return "";
  return `HARD RULE: the candidate has told us the following are NOT true. Never state, imply or hint at any of them anywhere in your output, not even reworded, softened or as part of another sentence. This overrides the CV data, the candidate's notes and any change request:\n${claims
    .map((c) => `- ${c}`)
    .join("\n")}`;
}
