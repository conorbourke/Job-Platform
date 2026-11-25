import type { SupabaseClient } from "@supabase/supabase-js";
import { aiJson, aiWebJson } from "./ai";
import { CLOUDFLARE_ACCOUNT_ID } from "@/config";

export interface ScrapedJob {
  job_title: string;
  company_name: string;
  location: string;
  salary_text: string;
  description: string;
}

/** Strip a fetched HTML page down to readable text (best effort). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** How much page text we keep and hand to the model (long postings run ~25k). */
const MAX_PAGE_CHARS = 40000;

/**
 * LinkedIn job id from any LinkedIn job link:
 *   /jobs/view/4477199196/…, /jobs/view/some-title-at-co-4477199196,
 *   …/jobs/search/?currentJobId=4477199196, or the guest jobPosting endpoint.
 */
export function linkedinJobId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const fromParam = u.searchParams.get("currentJobId");
  if (fromParam && /^\d{6,}$/.test(fromParam)) return fromParam;
  const m = u.pathname.match(/\/jobs(?:-guest\/jobs\/api\/jobPosting|\/view)\/(?:[^/]*?-)?(\d{6,})(?:\/|$)/);
  return m ? m[1] : null;
}

/**
 * A clean, stable link to store: LinkedIn links lose their tracking junk
 * (…?alternateChannel=…&trackingId=…), so the same job always has the same URL.
 */
export function canonicalJobUrl(url: string): string {
  const id = linkedinJobId(url);
  return id ? `https://www.linkedin.com/jobs/view/${id}/` : url;
}

/** The instruction both extraction paths share: keep the posting VERBATIM. */
const DESCRIPTION_RULES =
  '"description" is the FULL job description copied VERBATIM, exactly as written in the posting, from its first line to its last: every section (e.g. about the role, responsibilities, requirements, preferred experience, salary & benefits, about the company, hiring process, equality statement). Do NOT summarise, shorten, paraphrase or reorder anything. Keep the original headings on their own lines and keep every bullet point as a separate line starting with "- ". Leave out only website clutter that is not part of the posting (navigation, cookie banners, "show more", "similar jobs", sign-in prompts, other job listings).';

/**
 * Fetch a page's readable text, best-effort. Prefers Cloudflare Browser
 * Rendering (a real headless browser that runs JavaScript and presents a
 * proper browser fingerprint) — it gets through JS-heavy job boards and many
 * bot walls a plain server fetch cannot. Falls back to a direct fetch when
 * Browser Rendering isn't configured or fails. Returns "" if nothing readable
 * could be retrieved.
 */
export async function fetchReadableText(url: string): Promise<string> {
  const accountId = CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (accountId && token) {
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    // /markdown returns clean, already-stripped content — ideal for the model.
    try {
      const res = await fetch(`${base}/markdown`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const json = (await res.json()) as { result?: string };
        if (json.result?.trim()) return json.result.slice(0, MAX_PAGE_CHARS);
      }
    } catch {
      // fall through to /content
    }
    // /content returns fully-rendered HTML — strip it ourselves.
    try {
      const res = await fetch(`${base}/content`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const json = (await res.json()) as { result?: string };
        const text = htmlToText(json.result ?? "");
        if (text.trim()) return text.slice(0, MAX_PAGE_CHARS);
      }
    } catch {
      // fall through to plain fetch
    }
  }

  // Plain fetch fallback (works for simple, non-JS, non-walled pages).
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const text = htmlToText(await res.text());
      if (text.trim()) return text.slice(0, MAX_PAGE_CHARS);
    }
  } catch {
    // give up
  }
  return "";
}

/**
 * Best-effort job page scrape: fetch (a real browser where possible) + AI
 * reconstruction of the posting. Never throws for content problems — returns
 * whatever could be parsed (empty strings where nothing could).
 */
export async function scrapeJobUrl(
  supabase: SupabaseClient,
  userId: string,
  url: string
): Promise<Partial<ScrapedJob>> {
  // LinkedIn: its guest "jobPosting" endpoint returns just this one posting,
  // with the complete description and no login wall or page clutter.
  let text = "";
  const liId = linkedinJobId(url);
  if (liId) {
    text = await fetchReadableText(
      `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${liId}`
    );
  }
  if (!text) text = await fetchReadableText(url);
  if (text) return extractJobFromText(supabase, userId, text, url);

  // Our own fetch was blocked (e.g. bot wall). Let Claude retrieve it itself
  // via server-side web tools, as a best-effort fallback. Swallow errors
  // (e.g. AI not configured / rate limited) so this never throws — callers
  // rely on the docstring guarantee and still create a draft.
  try {
    const viaWeb = await aiWebJson<ScrapedJob>({
      supabase,
      userId,
      feature: "job_url_scrape",
      system: `Retrieve the job posting at the given URL (use web_fetch; if that fails, use web_search to find the same posting). Return ONLY JSON: {"job_title":string,"company_name":string,"location":string,"salary_text":string,"description":string}. ${DESCRIPTION_RULES} Use "" for any field you genuinely cannot find. Never invent details.`,
      user: `Job posting URL: ${url}`,
      maxOutputTokens: 12000,
    });
    return viaWeb ?? {};
  } catch {
    return {};
  }
}

/**
 * Reconstruct a job posting from raw page text/markdown the user pastes in.
 * This is the reliable path for bot-walled sites (LinkedIn, Indeed): the user
 * copies the page, the AI rebuilds the structured draft. Never throws.
 */
export async function extractJobFromText(
  supabase: SupabaseClient,
  userId: string,
  text: string,
  url?: string
): Promise<Partial<ScrapedJob>> {
  if (!text.trim()) return {};
  try {
    return await aiJson<ScrapedJob>({
      supabase,
      userId,
      feature: "job_url_scrape",
      system: `You read the text/markdown of a job posting page and extract the posting. Return JSON: {"job_title":string,"company_name":string,"location":string,"salary_text":string,"description":string}. ${DESCRIPTION_RULES} "salary_text" is the salary or pay as stated (e.g. "£35,000 - £45,000"). Use "" for any field genuinely not present. Never invent details that are not in the text.`,
      user: `${url ? `Source URL: ${url}\n\n` : ""}Content:\n${text.slice(0, MAX_PAGE_CHARS)}`,
      // A full verbatim posting can be long; leave plenty of room so the JSON
      // isn't cut off mid-description.
      maxOutputTokens: 12000,
    });
  } catch {
    return {};
  }
}

/**
 * Find-or-create a company for the user by name (case-insensitive match —
 * companies stay keyed by their fixed UUID).
 */
export async function matchOrCreateCompany(
  supabase: SupabaseClient,
  userId: string,
  companyName: string
): Promise<string | null> {
  const name = companyName.trim();
  if (!name) return null;
  const { data: existing } = await supabase
    .from("companies")
    .select("id")
    .ilike("name", name)
    .limit(1);
  if (existing && existing.length > 0) return existing[0].id;
  const { data: created } = await supabase
    .from("companies")
    .insert({ user_id: userId, name, tier: "secondary" })
    .select("id")
    .single();
  return created?.id ?? null;
}
