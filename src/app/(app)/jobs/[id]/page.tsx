import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApplyWorkspace, type GeneratedPair } from "@/components/apply-workspace";
import { queuePosition, sortQueue } from "@/lib/apply";
import { todayLocal } from "@/lib/today";
import type {
  Application,
  Company,
  CvTemplate,
  FormSubmission,
  GeneratedDocument,
} from "@/lib/types";

export const metadata = { title: "Apply" };
export const dynamic = "force-dynamic";

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ applied?: string }>;
}) {
  const { id } = await params;
  const { applied } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: application } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .maybeSingle<Application>();
  if (!application) notFound();
  // Already applied: it lives in Applied now.
  if (application.status !== "draft") redirect(`/tracker?open=${id}`);

  const [
    { data: companies },
    { data: templates },
    { data: docs },
    { data: submission },
    { data: drafts },
    { data: earlier },
  ] = await Promise.all([
    supabase.from("companies").select("*").order("name").returns<Company[]>(),
    supabase
      .from("cv_templates")
      .select("*")
      .order("is_master", { ascending: false })
      .order("created_at")
      .returns<CvTemplate[]>(),
    supabase
      .from("generated_documents")
      .select("*")
      .eq("application_id", id)
      .in("type", ["cv", "cover_letter"])
      .order("version", { ascending: false })
      .returns<GeneratedDocument[]>(),
    supabase
      .from("form_submissions")
      .select("*")
      .eq("application_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<FormSubmission>(),
    supabase
      .from("applications")
      .select("id, due_date, suitability, created_at")
      .eq("status", "draft"),
    application.company_id
      ? supabase
          .from("applications")
          .select("job_title")
          .eq("company_id", application.company_id)
          .neq("status", "draft")
      : Promise.resolve({ data: [] as { job_title: string }[] }),
  ]);

  const cv = (docs ?? []).find((d) => d.type === "cv");
  const cover = (docs ?? []).find((d) => d.type === "cover_letter");
  const initialDocs: GeneratedPair | null =
    cv && cover
      ? {
          cvDocId: cv.id,
          coverDocId: cover.id,
          emailSubject: cv.meta?.email_subject ?? "",
          emailBody: cv.meta?.email_body ?? "",
          applicationEmail: cv.meta?.application_email ?? "",
          version: cv.version,
          createdAt: cv.created_at,
        }
      : null;

  const order = sortQueue(
    (drafts ?? []) as { id: string; due_date: string | null; suitability: Application["suitability"]; created_at: string }[]
  ).map((d) => d.id);

  return (
    <ApplyWorkspace
      key={application.id}
      application={application}
      companies={companies ?? []}
      cvTemplates={templates ?? []}
      initialDocs={initialDocs}
      initialSubmission={submission ?? null}
      queue={queuePosition(order, application.id)}
      priorRoles={((earlier ?? []) as { job_title: string }[]).map((e) => e.job_title || "Untitled role")}
      today={todayLocal()}
      justApplied={applied === "1"}
    />
  );
}
