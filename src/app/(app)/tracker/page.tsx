import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sortTrackerRows, type TrackerRow } from "@/lib/sort";
import type { Application, Company, Interview } from "@/lib/types";
import { TrackerClient } from "./tracker-client";

export const metadata = { title: "Applied" };
export const dynamic = "force-dynamic";

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: applications }, { data: companies }, { data: interviews }] = await Promise.all([
    supabase.from("applications").select("*").returns<Application[]>(),
    supabase.from("companies").select("*").order("name").returns<Company[]>(),
    supabase.from("interviews").select("*").order("scheduled_at").returns<Interview[]>(),
  ]);

  const companyNames = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const now = Date.now();
  const nextInterview = new Map<string, string>();
  for (const iv of interviews ?? []) {
    const t = new Date(iv.scheduled_at).getTime();
    if (t >= now && !nextInterview.has(iv.application_id)) {
      nextInterview.set(iv.application_id, iv.scheduled_at);
    }
  }

  const rows: TrackerRow[] = (applications ?? []).map((a) => ({
    ...a,
    company_name: a.company_id ? companyNames.get(a.company_id) ?? null : null,
    next_interview_at: nextInterview.get(a.id) ?? null,
  }));

  // Jobs not yet applied for are worked through in Jobs (the Apply workspace).
  const toApplyCount = rows.filter((r) => r.status === "draft").length;
  const applied = sortTrackerRows(rows.filter((r) => r.status !== "rejected" && r.status !== "draft"));
  const rejected = rows
    .filter((r) => r.status === "rejected")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <TrackerClient
      toApplyCount={toApplyCount}
      applied={applied}
      rejected={rejected}
      companies={companies ?? []}
      initialOpenId={open ?? null}
    />
  );
}
