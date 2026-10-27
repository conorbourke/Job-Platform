import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { anySourceConfigured } from "@/lib/jobsources";
import { deriveQuery } from "@/lib/recommend";
import type { RecommendedJob } from "@/lib/types";
import { RecommendedClient } from "./recommended-client";

export const metadata = { title: "Recommended" };
export const dynamic = "force-dynamic";

export default async function RecommendedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: jobs }, matching] = await Promise.all([
    supabase
      .from("recommended_jobs")
      .select("*")
      .eq("status", "new")
      .order("score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .returns<RecommendedJob[]>(),
    // What the daily run is matching on, derived from the jobs applied for.
    deriveQuery(supabase, user.id),
  ]);

  return (
    <RecommendedClient
      jobs={jobs ?? []}
      sourcesConfigured={anySourceConfigured()}
      matching={{
        keywords: matching.keywords,
        locations: matching.locations,
        sourceDomains: matching.sourceDomains ?? [],
      }}
    />
  );
}
