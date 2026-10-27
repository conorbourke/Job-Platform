import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { debugScrapeSources } from "@/lib/scrapesources";
import { fetchFreeApiSources } from "@/lib/apisources";
import { fetchAllSources, type RawJob } from "@/lib/jobsources";
import { fetchWebSearchSources } from "@/lib/websearchsources";
import { deriveQuery } from "@/lib/recommend";
import { buildCandidateProfile } from "@/lib/suitability";

/**
 * Diagnostics for the recommendation sources. Visit while logged in:
 *   /api/recommendations/debug
 * Shows the query derived from the jobs applied for (roles, locations and the
 * sites they were posted on) and how many postings each source group returns,
 * so an empty run can be traced to a specific source.
 */
export const maxDuration = 180;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = await deriveQuery(supabase, user.id);

  const [profile, diag, siteJobs, freeJobs, keyedJobs] = await Promise.all([
    buildCandidateProfile(supabase, user.id),
    debugScrapeSources(supabase, user.id, query),
    fetchWebSearchSources(supabase, user.id, query),
    fetchFreeApiSources(query),
    fetchAllSources(query),
  ]);

  const countBySource = (jobs: RawJob[]) => {
    const c: Record<string, number> = {};
    for (const j of jobs) c[j.source] = (c[j.source] ?? 0) + 1;
    return c;
  };

  return NextResponse.json({
    browserRenderingConfigured: Boolean(process.env.CLOUDFLARE_API_TOKEN),
    adzunaConfigured: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
    reedConfigured: Boolean(process.env.REED_API_KEY),
    derived: {
      keywords: query.keywords,
      locations: query.locations,
      sourceDomains: query.sourceDomains ?? [],
    },
    profilePreview: profile.slice(0, 400),
    appliedSiteSearch: countBySource(siteJobs), // per applied-through domain
    appliedSiteSample: siteJobs.slice(0, 5).map((j) => ({ title: j.title, url: j.url })),
    freeApiSources: countBySource(freeJobs), // themuse / remotive / arbeitnow
    keyedApiSources: countBySource(keyedJobs), // adzuna / reed (if keys set)
    scrapeSources: diag, // linkedin / indeed / jobs.ie / nijobfinder
  });
}
