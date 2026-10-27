import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { matchOrCreateCompany, scrapeJobUrl } from "@/lib/scrape";
import type { RecommendedJob } from "@/lib/types";

/**
 * Act on a single recommendation.
 *   PATCH { action: "dismiss" }  → hide it
 *   PATCH { action: "add" }      → create a New Jobs draft from it and mark
 *                                  the recommendation as added
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action } = await request.json().catch(() => ({}));

  const { data: rec } = await supabase
    .from("recommended_jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle<RecommendedJob>();
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "dismiss") {
    await supabase
      .from("recommended_jobs")
      .update({ status: "dismissed" })
      .eq("id", id)
      .eq("user_id", user.id);
    return NextResponse.json({ ok: true, status: "dismissed" });
  }

  if (action === "add") {
    // A recommendation often carries only a title, link and snippet. Fetch the
    // full advert now so the draft has a real description to tailor the CV
    // against. Best-effort: a blocked page just leaves the snippet in place.
    const details = {
      company_name: rec.company_name,
      location: rec.location,
      salary_text: rec.salary_text,
      description: rec.description,
    };
    if (rec.url && (rec.description ?? "").length < 300) {
      try {
        const scraped = await scrapeJobUrl(supabase, user.id, rec.url);
        details.company_name ||= scraped.company_name || null;
        details.location ||= scraped.location || null;
        details.salary_text ||= scraped.salary_text || null;
        if ((scraped.description ?? "").length > (details.description ?? "").length) {
          details.description = scraped.description ?? null;
        }
      } catch {
        // keep the snippet
      }
    }

    const companyId = details.company_name
      ? await matchOrCreateCompany(supabase, user.id, details.company_name)
      : null;

    const { data: application, error } = await supabase
      .from("applications")
      .insert({
        user_id: user.id,
        company_id: companyId,
        job_title: rec.title,
        location: details.location,
        salary_text: details.salary_text,
        job_description_text: details.description,
        job_url: rec.url,
        status: "draft",
        source: "suggested",
        application_type: "email",
        suitability: rec.suitability,
        suitability_reason: rec.suitability_reason,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabase
      .from("recommended_jobs")
      .update({ status: "added" })
      .eq("id", id)
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true, status: "added", application });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
