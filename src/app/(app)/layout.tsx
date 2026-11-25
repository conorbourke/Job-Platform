import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import type { Profile } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (profile?.deactivated) redirect("/login?error=deactivated");

  return (
    <div className="min-h-screen md:flex">
      <Sidebar userName={profile?.name || user.email || ""} />
      <main className="min-w-0 flex-1 px-4 py-6 md:ml-56 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
