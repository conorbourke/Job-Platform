import type { SupabaseClient } from "@supabase/supabase-js";
import { aiWebJson } from "./ai";
import { stableId } from "./scrapesources";
import type { RawJob, SourceQuery } from "./jobsources";

/**
 * Discovery on the job sites the user has ACTUALLY applied through. We take the
 * domains from their applied jobs' URLs and, for each domain × role keyword,
 * have Claude run a `site:<domain> <role> <location>` web search (Anthropic's
 * server-side web_search tool) and return the postings it finds.
 *
 * Source-agnostic by design: it works for any board without us knowing that
 * site's search-URL format, and it isn't blocked the way server-side scraping
 * of LinkedIn/Indeed is. Guarantees the minimum of title + link; company and a
 * snippet come along when the results expose them. Full content is fetched
 * later, on "Add to New Jobs".
 *
 * Each call is a paid web search (~1p each plus a little for tokens), so the
 * fan-out is capped at domains × keywords. 6 × 3 = 18 searches a run, roughly
 * 20–30p a day at one run per day.
 */

const MAX_DOMAINS = 6;
const MAX_KEYWORDS = 3;

interface FoundPosting {
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  snippet?: string;
}

const SYSTEM = `You find current job adverts on ONE specific job website.

Run web_search with the exact query you are given (it uses the site: operator to stay on that website). You may web_fetch a result page to confirm it is a single job advert and pull a one-sentence description, but keep it quick.

Return ONLY a JSON array (no prose) of up to 10 postings, each:
{"title": string, "company": string, "location": string, "url": string, "snippet": string}

Rules:
- "url" must be the direct link to ONE specific job advert on that website — not a search page, category page or the homepage.
- Prefer recently posted adverts.
- Use "" for a field you genuinely can't see. Never invent postings or details.
- If the search returns no job adverts on that site, return [].`;

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

async function searchOne(
  supabase: SupabaseClient,
  userId: string,
  domain: string,
  keyword: string,
  location: string
): Promise<RawJob[]> {
  const query = `site:${domain} ${keyword} ${location}`.trim();
  const found = await aiWebJson<FoundPosting[]>({
    supabase,
    userId,
    feature: "job_site_search",
    system: SYSTEM,
    user: `Website: ${domain}\nRun web_search with this query: ${query}`,
    maxOutputTokens: 2000,
  });
  if (!Array.isArray(found)) return [];

  const out: RawJob[] = [];
  for (const f of found) {
    const title = (f.title ?? "").trim();
    const url = (f.url ?? "").trim();
    if (!title || !url) continue; // the minimum we promise is title + link
    // Guard against the model wandering off-site.
    const host = hostnameOf(url);
    if (!host || !(host === domain || host.endsWith(`.${domain}`))) continue;
    const company = (f.company ?? "").trim();
    out.push({
      source: domain,
      external_id: stableId(url, title, company),
      title,
      company_name: company || null,
      location: (f.location ?? "").trim() || null,
      salary_text: null,
      url,
      description: (f.snippet ?? "").trim() || null,
      posted_at: null,
    });
  }
  return out;
}

/** Search every applied-through site for the user's top roles. */
export async function fetchWebSearchSources(
  supabase: SupabaseClient,
  userId: string,
  q: SourceQuery
): Promise<RawJob[]> {
  const domains = (q.sourceDomains ?? []).slice(0, MAX_DOMAINS);
  if (domains.length === 0) return [];
  const keywords = q.keywords.slice(0, MAX_KEYWORDS);
  const location = q.locations[0] ?? "";

  const tasks: Promise<RawJob[]>[] = [];
  for (const domain of domains) {
    for (const kw of keywords) {
      tasks.push(
        searchOne(supabase, userId, domain, kw, location).catch(() => [] as RawJob[])
      );
    }
  }
  const batches = await Promise.all(tasks);

  const seen = new Set<string>();
  const merged: RawJob[] = [];
  for (const job of batches.flat()) {
    const key = `${job.source}:${job.external_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(job);
  }
  return merged;
}
