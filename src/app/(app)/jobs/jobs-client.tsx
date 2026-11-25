"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CompanyList } from "@/components/company-list";
import { RecommendedList } from "@/components/recommended-list";
import { SuitabilityBadge } from "@/components/suitability-badge";
import { deadlineLabel } from "@/lib/apply";
import type { Company, RecommendedJob, Suitability } from "@/lib/types";

export interface QueueRow {
  id: string;
  job_title: string;
  company_name: string | null;
  location: string | null;
  due_date: string | null;
  suitability: Suitability | null;
  suitability_reason: string | null;
  job_description_text_present: boolean;
  cv_ready: boolean;
  attach_portfolio: boolean;
  prior_roles: string[];
}

type Tab = "queue" | "recommended" | "companies";

/**
 * Jobs: capture a job (URL or pasted advert), then work through the queue of
 * jobs to apply for — each opens in the Apply workspace. Recommended jobs and
 * the company list are tabs here too.
 */
export function JobsClient({
  tab,
  rows,
  unscoredIds,
  appliedToday,
  justFinished,
  today,
  companies,
  applicationCounts,
  recommendations,
  sourcesConfigured,
  matching,
  autoTailorTemplateId,
}: {
  tab: Tab;
  rows: QueueRow[];
  unscoredIds: string[];
  appliedToday: number;
  justFinished: boolean;
  today: string;
  companies: Company[];
  applicationCounts: Record<string, number>;
  recommendations: RecommendedJob[];
  sourcesConfigured: boolean;
  matching: { keywords: string[]; locations: string[]; sourceDomains: string[] };
  /** Set when "Tailor good matches in the background" is on in Settings. */
  autoTailorTemplateId: string | null;
}) {
  const router = useRouter();
  const tailoring = useAutoTailor(rows, autoTailorTemplateId);

  // Score any jobs without a match rating yet, once, then show the badges.
  const scoringRef = useRef(false);
  useEffect(() => {
    if (unscoredIds.length === 0 || scoringRef.current) return;
    scoringRef.current = true;
    fetch("/api/suitability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationIds: unscoredIds }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.scored > 0) router.refresh();
      })
      .catch(() => {});
  }, [unscoredIds, router]);

  async function createBlank(companyId?: string) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data } = await supabase
      .from("applications")
      .insert({
        user_id: user!.id,
        status: "draft",
        source: companyId ? "manual" : "suggested",
        company_id: companyId ?? null,
        job_title: "",
      })
      .select("id")
      .single();
    if (data) router.push(`/jobs/${data.id}`);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "queue", label: `To apply (${rows.length})` },
    { key: "recommended", label: `Recommended (${recommendations.length})` },
    { key: "companies", label: "Companies" },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Paste a job advert to add it, then work through your queue — each job opens
          ready to tailor, send and mark applied.
        </p>
      </div>

      <CaptureBar onBlank={() => createBlank()} />

      {justFinished && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          🎉 <strong>All caught up.</strong>{" "}
          {appliedToday > 0
            ? `You've applied for ${appliedToday} job${appliedToday === 1 ? "" : "s"} today.`
            : "Nothing left in the queue."}
        </div>
      )}

      <nav className="flex gap-1 border-b border-neutral-200 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "queue" ? "/jobs" : `/jobs?tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${
              tab === t.key
                ? "border-accent-600 text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "queue" && (
        <Queue rows={rows} today={today} tailoring={tailoring} onBlank={() => createBlank()} />
      )}

      {tab === "recommended" && (
        <RecommendedList jobs={recommendations} sourcesConfigured={sourcesConfigured} matching={matching} />
      )}

      {tab === "companies" && (
        <CompanyList
          companies={companies}
          applicationCounts={applicationCounts}
          onCreateApplication={(companyId) => createBlank(companyId)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

type TailorState = "working" | "done" | "failed";

/**
 * Background tailoring: while this page is open, generate the CV and cover
 * letter for medium/high matches that have a description but no CV yet.
 * One job at a time, top of the queue first; stops if you leave the page or
 * if a request fails for a reason that would fail again (e.g. AI limits).
 */
function useAutoTailor(rows: QueueRow[], templateId: string | null) {
  const [state, setState] = useState<Record<string, TailorState>>({});
  const tried = useRef(new Set<string>());
  const running = useRef(false);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  useEffect(() => {
    if (!templateId || running.current) return;
    const todo = rows.filter(
      (r) =>
        !r.cv_ready &&
        r.job_description_text_present &&
        (r.suitability === "high" || r.suitability === "medium") &&
        !tried.current.has(r.id)
    );
    if (todo.length === 0) return;
    running.current = true;
    (async () => {
      for (const r of todo) {
        if (stopped.current) break;
        tried.current.add(r.id);
        setState((s) => ({ ...s, [r.id]: "working" }));
        const res = await fetch("/api/generate/cv-cover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            application_id: r.id,
            cv_template_id: templateId,
            attach_portfolio: r.attach_portfolio,
          }),
        }).catch(() => null);
        setState((s) => ({ ...s, [r.id]: res?.ok ? "done" : "failed" }));
        // Limits / auth problems won't fix themselves on the next job.
        if (!res || [401, 403, 429, 503].includes(res.status)) break;
      }
      running.current = false;
    })();
  }, [rows, templateId]);

  return state;
}

function Queue({
  rows,
  today,
  tailoring,
  onBlank,
}: {
  rows: QueueRow[];
  today: string;
  tailoring: Record<string, TailorState>;
  onBlank: () => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        Nothing waiting — paste a job advert above, check{" "}
        <Link href="/jobs?tab=recommended" className="underline">Recommended</Link>, or{" "}
        <button onClick={onBlank} className="underline">add a job manually</button>.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Ordered by deadline (unknown deadlines first, so you can check them), then best match.
        </p>
        <Link href={`/jobs/${rows[0].id}`} className="btn-primary">
          Start applying →
        </Link>
      </div>
      <div className="card divide-y divide-neutral-100">
        {rows.map((r) => {
          const d = deadlineLabel(r.due_date, today);
          return (
            <Link
              key={r.id}
              href={`/jobs/${r.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-neutral-50"
              title={tailoring[r.id] === "failed" ? "Background tailoring didn't work for this one. Open it to generate." : undefined}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-neutral-900">
                    {r.job_title || "Untitled job"}
                  </span>
                  <SuitabilityBadge value={r.suitability} reason={r.suitability_reason} />
                  {r.prior_roles.length > 0 && (
                    <span
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                      title={`You've applied here before for: ${r.prior_roles.join(", ")}`}
                    >
                      Applied here before
                    </span>
                  )}
                  {(r.cv_ready || tailoring[r.id] === "done") && (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                      CV ready
                    </span>
                  )}
                  {tailoring[r.id] === "working" && (
                    <span className="animate-pulse rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                      Tailoring…
                    </span>
                  )}
                  {!r.job_description_text_present && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
                      needs description
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-neutral-400">
                  {[r.company_name ?? "No company", r.location].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs font-medium ${
                  d.tone === "past" ? "text-red-600" : d.tone === "soon" ? "text-amber-700" : "text-neutral-400"
                }`}
              >
                {d.text}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function CaptureBar({ onBlank }: { onBlank: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<React.ReactNode>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "text" ? { text, url: url || undefined } : { url }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice(json.error ?? "Couldn't add that job.");
      return;
    }
    const id = json.application?.id as string | undefined;
    if (json.duplicate && json.application?.status !== "draft") {
      setNotice(
        <>
          You&apos;ve already applied for this job —{" "}
          <Link href={`/tracker?open=${id}`} className="underline">see it in Applied</Link>.
        </>
      );
      return;
    }
    setUrl("");
    setText("");
    // If the page couldn't be read, the workspace opens with the description
    // box showing so the advert can be pasted in.
    if (id) router.push(`/jobs/${id}`);
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex gap-1 rounded-lg bg-neutral-200/60 p-1 text-xs font-medium">
        {(
          [
            ["url", "From a link"],
            ["text", "Paste the advert"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
              mode === m ? "bg-white shadow-sm" : "text-neutral-500 hover:text-neutral-800"
            }`}>
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-2">
        {mode === "url" ? (
          <div className="flex gap-2">
            <input className="input" type="url" required value={url}
              placeholder="Paste a job advert link — we'll read it and open it ready to apply"
              onChange={(e) => setUrl(e.target.value)} />
            <button type="submit" disabled={busy} className="btn-primary shrink-0">
              {busy ? "Reading…" : "Add job"}
            </button>
          </div>
        ) : (
          <>
            <textarea className="input min-h-32" required value={text}
              placeholder="Paste the whole job advert here — title, company, description, everything"
              onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <input className="input" type="url" value={url}
                placeholder="Link to the advert (optional)"
                onChange={(e) => setUrl(e.target.value)} />
              <button type="submit" disabled={busy} className="btn-primary shrink-0">
                {busy ? "Reading…" : "Add job"}
              </button>
            </div>
          </>
        )}
      </form>
      <div className="mt-2 flex items-center justify-between text-xs">
        {notice ? <p className="text-amber-700">{notice}</p> : <span />}
        <button onClick={onBlank} className="text-neutral-500 hover:text-neutral-800">
          + Add a job manually
        </button>
      </div>
    </div>
  );
}
