import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSettings } from "./types";

/**
 * Accuracy rules every prompt that writes about the candidate shares, so a
 * finished qualification is never described as one still in progress.
 */
export const QUALIFICATION_RULE =
  'QUALIFICATIONS: Treat every degree, qualification and course as COMPLETED unless its dates clearly show it is still running (an end of "Present", "ongoing" or a future year) AND the candidate facts below do not say otherwise. Never write "currently studying", "pursuing", "undertaking", "working towards", "in progress" or similar about a completed qualification. Keep any grade or classification (e.g. Distinction) exactly as given.';

/** Longest facts text we pass to the model. */
export const MAX_FACTS_CHARS = 2000;

/**
 * The candidate's own "always true" facts as a prompt block, or "" if none.
 * They win over anything in templates, notes or earlier versions.
 */
export function factsBlock(facts: string | null | undefined): string {
  const text = (facts ?? "").trim().slice(0, MAX_FACTS_CHARS);
  if (!text) return "";
  return `CANDIDATE FACTS (written by the candidate, always true; they override anything in the CV templates, notes or previous versions that conflicts with them, including the tense of qualifications):\n${text}`;
}

/** Load the facts block for a user (empty string when none are set). */
export async function loadFactsBlock(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", userId)
    .maybeSingle<{ settings: UserSettings | null }>();
  return factsBlock(data?.settings?.ai_facts);
}
