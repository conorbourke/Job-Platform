import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  canonicalJobUrl,
  extractJobFromText,
  matchOrCreateCompany,
  scrapeJobUrl,
  type ScrapedJob,
} from "@/lib/scrape";
import { buildCandidateProfile, scoreJobs } from "@/lib/suitability";
import type { Application } from "@/lib/types";

/**
 * Create a draft application from either:
 *  - a job URL (best-effort scrape via Browser Rendering → AI extraction), or
 *  - pasted job text (reliable path for bot-walled sites).
 * The job description is kept verbatim (full text, headings and bullets).
 * Scrape/extraction failure never blocks: a draft with the URL is still created.
 *
 * With `application_id`, re-reads that existing draft instead: its description
 * is replaced with a fresh full copy, empty fields are filled in, and it's
 * queued for re-scoring.
 *
 * A URL that's already captured returns the existing application with
 * `duplicate: true` rather than creating a second copy.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { url: rawUrl, text, source, application_id } = await request.json();
  const validUrl = typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl);
  const url = validUrl ? canonicalJobUrl(rawUrl.trim()) : null;
  const pasted = typeof text === "string" && text.trim().length > 0;

  if (!url && !pasted) {
    return NextResponse.json(
      { error: "Provide a valid http(s) URL or paste the job text." },
      { status: 400 }
    );
  }

  // ---- Refresh an existing draft --------------------------------------------
  if (typeof application_id === "string" && application_id) {
    const { data: existing } = await supabase
      .from("applications")
      .select("*")
      .eq("id", application_id)
      .maybeSingle<Application>();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let scraped: Partial<ScrapedJob> = {};
    try {
      scraped = pasted
        ? await extractJobFromText(supabase, user.id, text, url ?? undefined)
        : await scrapeJobUrl(supabase, user.id, url!);
    } catch {
      scraped = {};
    }
    if (!scraped.description?.trim()) {
      return NextResponse.json(
        {
          error:
            "Couldn't read the job page just now. Paste the posting text into the description instead.",
        },
        { status: 422 }
      );
    }

    const companyId =
      existing.company_id ??
      (scraped.company_name
        ? await matchOrCreateCompany(supabase, user.id, scraped.company_name)
        : null);
    const { data: updated, error } = await supabase
      .from("applications")
      .update({
        job_description_text: scraped.description,
        job_title: existing.job_title || scraped.job_title || "",
        location: existing.location || scraped.location || null,
        salary_text: existing.salary_text || scraped.salary_text || null,
        company_id: companyId,
        job_url: url ?? existing.job_url,
        // New text → re-score the match next time New Jobs loads.
        suitability: null,
        suitability_reason: null,
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, application: updated, refreshed: true });
  }

  // ---- Already captured? Reuse it instead of creating a duplicate ----------
  if (url) {
    const { data: dupe } = await supabase
      .from("applications")
      .select("*")
      .eq("job_url", url)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Application>();
    if (dupe) {
      return NextResponse.json({ ok: true, application: dupe, duplicate: true, scraped: true });
    }
  }

  // Auto-fill is best-effort: scraping/AI can fail (bot walls, AI not
  // configured, rate limits). Never let that block the draft — fall back to an
  // empty result and still create the application with the URL, as documented.
  let scraped: Partial<ScrapedJob> = {};
  try {
    scraped = pasted
      ? await extractJobFromText(supabase, user.id, text, url ?? undefined)
      : await scrapeJobUrl(supabase, user.id, url!);
  } catch {
    scraped = {};
  }

  const companyId = scraped.company_name
    ? await matchOrCreateCompany(supabase, user.id, scraped.company_name)
    : null;

  const { data: application, error } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      company_id: companyId,
      job_title: scraped.job_title ?? "",
      location: scraped.location || null,
      salary_text: scraped.salary_text || null,
      job_description_text: scraped.description || null,
      job_url: url,
      status: "draft",
      source: source === "application_form" ? "application_form" : "suggested",
      application_type: source === "application_form" ? "web_form" : "email",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Score suitability (low/medium/high) best-effort so the new draft shows a
  // match badge immediately. Never let this block draft creation.
  if (application && (application.job_title || application.job_description_text)) {
    try {
      const profile = await buildCandidateProfile(supabase, user.id);
      const [s] = await scoreJobs(supabase, user.id, profile, [
        {
          ref: application.id,
          title: application.job_title || "Untitled role",
          company: scraped.company_name ?? null,
          location: application.location,
          description: application.job_description_text,
        },
      ]);
      if (s) {
        await supabase
          .from("applications")
          .update({ suitability: s.suitability, suitability_reason: s.reason })
          .eq("id", application.id);
        application.suitability = s.suitability;
        application.suitability_reason = s.reason;
      }
    } catch {
      // leave unscored
    }
  }

  return NextResponse.json({
    ok: true,
    application,
    scraped: Object.keys(scraped).length > 0,
  });
}
