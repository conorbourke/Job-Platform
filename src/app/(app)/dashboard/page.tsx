import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deadlineLabel, daysUntil, followUpDays, FOLLOW_UP_AFTER_DAYS, sortQueue } from "@/lib/apply";
import { formatDateTime } from "@/lib/labels";
import { matchesSearchLocation } from "@/lib/location";
import { todayLocal } from "@/lib/today";
import type { Application, Company, Interview } from "@/lib/types";
import { PipelineChart } from "./pipeline-chart";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Today: what needs doing now — jobs to apply for (deadlines first), new
 * recommendations, interviews coming up and applications due a follow-up —
 * each one click from the right place. Progress stats sit underneath.
 */
export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: apps }, { data: interviews }, { data: companies }, { data: recs }] = await Promise.all([
    supabase.from("applications").select("*").returns<Application[]>(),
    supabase.from("interviews").select("*").returns<Interview[]>(),
    supabase.from("companies").select("id, name").returns<Pick<Company, "id" | "name">[]>(),
    supabase.from("recommended_jobs").select("location").eq("status", "new"),
  ]);

  const applications = apps ?? [];
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const today = todayLocal();
  const now = new Date();

  // ---- To apply ------------------------------------------------------------
  const queue = sortQueue(applications.filter((a) => a.status === "draft"));
  const dueThisWeek = queue.filter((a) => {
    if (!a.due_date) return false;
    const n = daysUntil(a.due_date, today);
    return n >= 0 && n <= 7;
  });
  const newRecs = (recs ?? []).filter((r) => matchesSearchLocation(r.location as string | null)).length;

  // ---- Interviews in the next 7 days ----------------------------------------
  const appById = new Map(applications.map((a) => [a.id, a]));
  const upcoming = (interviews ?? [])
    .filter((iv) => {
      const t = new Date(iv.scheduled_at).getTime();
      return t >= now.getTime() && t <= now.getTime() + 7 * DAY;
    })
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  // ---- Follow-ups due --------------------------------------------------------
  const followUps = applications
    .map((a) => ({ a, days: followUpDays(a, today) }))
    .filter((x): x is { a: Application; days: number } => x.days !== null)
    .sort((x, y) => y.days - x.days);

  // ---- Progress --------------------------------------------------------------
  const submitted = applications.filter((a) => a.date_submitted);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
  const weekStr = startOfWeek.toISOString().slice(0, 10);
  const monthStr = today.slice(0, 8) + "01";
  const counts = {
    today: submitted.filter((a) => a.date_submitted === today).length,
    week: submitted.filter((a) => a.date_submitted! >= weekStr).length,
    month: submitted.filter((a) => a.date_submitted! >= monthStr).length,
    allTime: submitted.length,
  };
  const weeks: { label: string; applications: number; interviews: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(startOfWeek.getTime() - i * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    const s = start.toISOString().slice(0, 10);
    const e = end.toISOString().slice(0, 10);
    weeks.push({
      label: `${start.getDate()}/${start.getMonth() + 1}`,
      applications: submitted.filter((a) => a.date_submitted! >= s && a.date_submitted! < e).length,
      interviews: (interviews ?? []).filter(
        (iv) => iv.scheduled_at >= start.toISOString() && iv.scheduled_at < end.toISOString()
      ).length,
    });
  }
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const stalled = submitted.length > 0 && !submitted.some((a) => a.date_submitted! >= sevenDaysAgo);

  const dateHeading = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-neutral-500">{dateHeading}</p>
      </div>

      {stalled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>No applications in the last 7 days</strong> — interviews dry up 2–3 weeks later.
          Keep the top of the funnel moving even while interviews are busy.
        </div>
      )}

      {/* What needs doing */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ActionTile
          href={queue[0] ? `/jobs/${queue[0].id}` : "/jobs"}
          label="To apply"
          value={queue.length}
          note={dueThisWeek.length ? `${dueThisWeek.length} due this week` : queue.length ? "Start applying →" : "Queue is clear"}
          tone={dueThisWeek.length ? "amber" : "accent"}
        />
        <ActionTile
          href="/jobs?tab=recommended"
          label="New recommendations"
          value={newRecs}
          note={newRecs ? "Review & add →" : "Checked daily"}
        />
        <ActionTile
          href="/tracker"
          label="Interviews this week"
          value={upcoming.length}
          note={upcoming[0] ? formatDateTime(upcoming[0].scheduled_at) : "None booked"}
          tone={upcoming.length ? "green" : undefined}
        />
        <ActionTile
          href={followUps[0] ? `/tracker?open=${followUps[0].a.id}` : "/tracker"}
          label="Follow-ups due"
          value={followUps.length}
          note={followUps.length ? `No reply in ${FOLLOW_UP_AFTER_DAYS}+ days` : "All quiet"}
          tone={followUps.length ? "amber" : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Up next to apply */}
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Up next</h2>
            {queue.length > 0 && (
              <Link href={`/jobs/${queue[0].id}`} className="text-sm font-medium text-accent-600 hover:underline">
                Start applying →
              </Link>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="text-sm text-neutral-400">
              Nothing waiting. <Link href="/jobs" className="underline">Add a job</Link> or check{" "}
              <Link href="/jobs?tab=recommended" className="underline">Recommended</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {queue.slice(0, 6).map((a) => {
                const d = deadlineLabel(a.due_date, today);
                return (
                  <li key={a.id}>
                    <Link href={`/jobs/${a.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-accent-700">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.job_title || "Untitled job"}</span>
                        <span className="block truncate text-xs text-neutral-400">
                          {a.company_id ? companyName.get(a.company_id) ?? "" : ""}
                        </span>
                      </span>
                      <span className={`shrink-0 text-xs ${d.tone === "past" ? "text-red-600" : d.tone === "soon" ? "text-amber-700" : "text-neutral-400"}`}>
                        {d.text}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {queue.length > 6 && (
                <li className="pt-2 text-xs">
                  <Link href="/jobs" className="text-neutral-500 hover:underline">+ {queue.length - 6} more in Jobs</Link>
                </li>
              )}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* Interviews */}
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Interviews — next 7 days</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-neutral-400">No interviews booked.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {upcoming.map((iv) => {
                  const app = appById.get(iv.application_id);
                  return (
                    <li key={iv.id}>
                      <Link href={`/tracker?open=${iv.application_id}`} className="block rounded-lg bg-green-50 px-3 py-2 hover:bg-green-100">
                        <span className="font-medium">{app?.job_title ?? "Interview"}</span>
                        <span className="block text-xs text-neutral-600">
                          {formatDateTime(iv.scheduled_at)}
                          {iv.location_text ? ` · ${iv.location_text}` : ""}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Follow-ups */}
          <section className="card p-5">
            <h2 className="mb-1 font-semibold">Follow up</h2>
            <p className="mb-3 text-xs text-neutral-500">
              Applied {FOLLOW_UP_AFTER_DAYS}+ days ago with no reply logged — a short check-in email often helps.
            </p>
            {followUps.length === 0 ? (
              <p className="text-sm text-neutral-400">Nothing due.</p>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm">
                {followUps.slice(0, 6).map(({ a, days }) => (
                  <li key={a.id}>
                    <Link href={`/tracker?open=${a.id}`} className="flex items-center justify-between gap-3 py-2 hover:text-accent-700">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{a.job_title || "Untitled"}</span>
                        {a.company_id && (
                          <span className="text-neutral-400"> · {companyName.get(a.company_id) ?? ""}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-amber-700">{days} days</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Progress */}
      <section className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold">Progress</h2>
            <p className="mt-1 text-xs text-neutral-500">Applications sent vs interviews, per week.</p>
          </div>
          <dl className="flex gap-6 text-sm">
            {(
              [
                ["Today", counts.today],
                ["This week", counts.week],
                ["This month", counts.month],
                ["All time", counts.allTime],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="text-right">
                <dt className="text-xs text-neutral-400">{label}</dt>
                <dd className="text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <PipelineChart weeks={weeks} />
      </section>
    </div>
  );
}

function ActionTile({
  href,
  label,
  value,
  note,
  tone,
}: {
  href: string;
  label: string;
  value: number;
  note: string;
  tone?: "accent" | "amber" | "green";
}) {
  const ring =
    tone === "amber" ? "border-amber-200 bg-amber-50/60" : tone === "green" ? "border-green-200 bg-green-50/60" : tone === "accent" ? "border-accent-200 bg-accent-50/50" : "";
  return (
    <Link href={href} className={`card p-5 transition-shadow hover:shadow-md ${ring}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
      <p className="mt-1 truncate text-xs text-neutral-500">{note}</p>
    </Link>
  );
}
