import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sortQueue } from "@/lib/apply";
import { anySourceConfigured } from "@/lib/jobsources";
import { deriveQuery, matchesSearchLocation } from "@/lib/recommend";
import { todayLocal } from "@/lib/today";
import type { Application, Company, RecommendedJob } from "@/lib/types";
import { JobsClient, type QueueRow } from "./jobs-client";

export const metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; done?: string }>;
}) {
  const { tab, done } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: drafts },
    { data: companies },
    { data: all },
    { data: recs },
    matching,
  ] = await Promise.all([
    supabase.from("applications").select("*").eq("status", "draft").returns<Application[]>(),
    supabase.from("companies").select("*").order("sort_order").returns<Company[]>(),
    supabase
      .from("applications")
      .select("company_id, status, job_title, date_submitted")
      .returns<Pick<Application, "company_id" | "status" | "job_title" | "date_submitted">[]>(),
    supabase
      .from("recommended_jobs")
      .select("*")
      .eq("status", "new")
      .order("score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .returns<RecommendedJob[]>(),
    deriveQuery(supabase, user.id),
  ]);

  const queue = sortQueue(drafts ?? []);

  // Which queued jobs already have a tailored CV ready?
  const ids = queue.map((d) => d.id);
  const { data: cvDocs } = ids.length
    ? await supabase.from("generated_documents").select("application_id").eq("type", "cv").in("application_id", ids)
    : { data: [] as { application_id: string }[] };
  const ready = new Set((cvDocs ?? []).map((d) => d.application_id));

  // Per company: how many applications, and which roles you've already applied for.
  const counts: Record<string, number> = {};
  const priorRoles: Record<string, string[]> = {};
  for (const a of all ?? []) {
    if (!a.company_id) continue;
    counts[a.company_id] = (counts[a.company_id] ?? 0) + 1;
    if (a.status !== "draft") (priorRoles[a.company_id] ??= []).push(a.job_title || "Untitled role");
  }

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const today = todayLocal();
  const rows: QueueRow[] = queue.map((d) => ({
    id: d.id,
    job_title: d.job_title,
    company_name: d.company_id ? companyName.get(d.company_id) ?? null : null,
    location: d.location,
    due_date: d.due_date,
    suitability: d.suitability,
    suitability_reason: d.suitability_reason,
    job_description_text_present: !!d.job_description_text?.trim(),
    cv_ready: ready.has(d.id),
    prior_roles: d.company_id ? priorRoles[d.company_id] ?? [] : [],
  }));

  return (
    <JobsClient
      tab={tab === "recommended" || tab === "companies" ? tab : "queue"}
      rows={rows}
      unscoredIds={queue
        .filter((d) => !d.suitability && (d.job_title || d.job_description_text))
        .map((d) => d.id)}
      appliedToday={(all ?? []).filter((a) => a.date_submitted === today).length}
      justFinished={done === "1"}
      today={today}
      companies={companies ?? []}
      applicationCounts={counts}
      recommendations={(recs ?? []).filter((j) => matchesSearchLocation(j.location))}
      sourcesConfigured={anySourceConfigured()}
      matching={{
        keywords: matching.keywords,
        locations: matching.locations,
        sourceDomains: matching.sourceDomains ?? [],
      }}
    />
  );
}
