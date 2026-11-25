import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminSettings } from "@/lib/settings";
import type { Profile, RoleOfInterest } from "@/lib/types";
import { SettingsClient } from "./settings-client";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: roles }, settings] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
    supabase.from("roles_of_interest").select("*").order("sort_order").returns<RoleOfInterest[]>(),
    getAdminSettings(supabase),
  ]);
  if (!profile) redirect("/login");

  return (
    <SettingsClient
      profile={profile}
      roles={roles ?? []}
      platform={{
        default_ai_model: settings.default_ai_model,
        cheap_ai_model: settings.cheap_ai_model,
        ai_monthly_generation_limit: settings.ai_monthly_generation_limit,
        max_companies: settings.max_companies,
        max_roles: settings.max_roles,
        max_cv_templates: settings.max_cv_templates,
      }}
    />
  );
}
