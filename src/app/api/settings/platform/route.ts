import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Save the app-wide AI & limits settings (admin_settings row 1). Only the
 * owner can reach this — middleware gates every API on the owner session — so
 * it writes with the service role rather than depending on a "superadmin"
 * profile role.
 */
const MODEL_RE = /^[a-z0-9][a-z0-9.\-:_]{2,79}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const errors: string[] = [];

  const model = (v: unknown, label: string) => {
    if (typeof v !== "string" || !MODEL_RE.test(v.trim())) {
      errors.push(`${label} must be a model ID like claude-haiku-4-5.`);
      return "";
    }
    return v.trim();
  };
  const count = (v: unknown, label: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100000) {
      errors.push(`${label} must be a whole number of at least 1.`);
      return 0;
    }
    return n;
  };

  const update = {
    default_ai_model: model(b.default_ai_model, "Writing model"),
    cheap_ai_model: model(b.cheap_ai_model, "Everyday model"),
    ai_monthly_generation_limit:
      b.ai_monthly_generation_limit === null || b.ai_monthly_generation_limit === ""
        ? null
        : count(b.ai_monthly_generation_limit, "Monthly limit"),
    max_companies: count(b.max_companies, "Max companies"),
    max_roles: count(b.max_roles, "Max target roles"),
    max_cv_templates: count(b.max_cv_templates, "Max CV templates"),
  };
  if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server isn't configured to save settings." }, { status: 503 });
  }
  const { error } = await createAdminClient().from("admin_settings").update(update).eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
