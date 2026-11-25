"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ScheduleInterview } from "@/components/schedule-interview";
import { followUpDays, gmailComposeLink } from "@/lib/apply";
import { STATUS_BADGE_CLASSES, STATUS_LABELS, formatDate, formatDateTime } from "@/lib/labels";
import { todayLocal } from "@/lib/today";
import type {
  Application,
  ApplicationEmail,
  ApplicationStatus,
  Company,
  GeneratedDocument,
  Interview,
} from "@/lib/types";

const DOC_LABELS: Record<string, string> = {
  cv: "CV",
  cover_letter: "Cover letter",
  company_brief: "Company & role brief",
  interview_prep: "Interview prep",
  completed_form_pdf: "Completed form (PDF)",
  completed_form_docx: "Completed form (Word)",
};

// Where an application can go after it's sent (draft lives in Jobs).
const QUICK_STATUSES: ApplicationStatus[] = [
  "applied",
  "screening_call",
  "in_person",
  "next_scheduled",
  "rejected",
];

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The panel for an application you've sent, ordered around what happens next:
 * status, a follow-up nudge, scheduling and interview prep, then documents and
 * emails. The job details are folded away at the bottom and save as you go.
 * Full-screen on phones, a side panel on wide screens.
 */
export function ApplicationDetail({
  application,
  companies,
  onClose,
  onChanged,
}: {
  application: Application & { company_name?: string | null };
  companies: Company[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [app, setApp] = useState(application);
  const appRef = useRef(app);
  appRef.current = app;
  const savedRef = useRef<Application>(application);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const [emails, setEmails] = useState<ApplicationEmail[]>([]);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [summary, setSummary] = useState(application.ai_summary);
  const [scheduling, setScheduling] = useState(false);

  const load = useCallback(async () => {
    const [e, d, i] = await Promise.all([
      supabase.from("application_emails").select("*").eq("application_id", application.id).order("pasted_at", { ascending: false }),
      supabase.from("generated_documents").select("*").eq("application_id", application.id).order("created_at", { ascending: false }),
      supabase.from("interviews").select("*").eq("application_id", application.id).order("scheduled_at", { ascending: false }),
    ]);
    setEmails((e.data as ApplicationEmail[]) ?? []);
    setDocuments((d.data as GeneratedDocument[]) ?? []);
    setInterviews((i.data as Interview[]) ?? []);
  }, [application.id, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- autosave -------------------------------------------------------------
  function persist(fields: Partial<Application>) {
    setSaveState("saving");
    const run = pending.current.then(async () => {
      const { error } = await supabase.from("applications").update(fields).eq("id", app.id);
      if (error) {
        setSaveState("error");
        return;
      }
      savedRef.current = { ...savedRef.current, ...fields };
      setSaveState("saved");
      onChanged();
    });
    pending.current = run.catch(() => {});
    return run;
  }
  function commit(fields: Partial<Application>) {
    setApp((p) => ({ ...p, ...fields }));
    return persist(fields);
  }
  function saveIfChanged<K extends keyof Application>(key: K) {
    const v = appRef.current[key];
    if (v === savedRef.current[key]) return;
    persist({ [key]: v } as Partial<Application>);
  }

  function setStatus(status: ApplicationStatus) {
    if (status === app.status) return;
    const fields: Partial<Application> = { status, status_changed_at: new Date().toISOString() };
    if (status === "applied" && !app.date_submitted) fields.date_submitted = todayLocal();
    commit(fields);
  }

  // ---- follow-up nudge --------------------------------------------------------
  const today = todayLocal();
  const waiting = followUpDays(app, today);
  const applicationEmail =
    documents.find((d) => d.type === "cv" && d.meta?.application_email)?.meta.application_email ?? "";
  const companyName =
    companies.find((c) => c.id === app.company_id)?.name ?? application.company_name ?? "";
  const followUpBody =
    `Hello,\n\nI applied for the ${app.job_title || "role"}${companyName ? ` at ${companyName}` : ""}` +
    `${app.date_submitted ? ` on ${formatDate(app.date_submitted)}` : ""} and wanted to check in on ` +
    `the status of my application. I'm still very interested in the position and would welcome ` +
    `the chance to discuss how my experience could help.\n\nKind regards,`;

  return (
    <aside className="card fixed inset-0 z-40 overflow-y-auto rounded-none p-5 lg:sticky lg:inset-auto lg:top-8 lg:z-auto lg:max-h-[calc(100vh-4rem)] lg:w-[26rem] lg:shrink-0 lg:rounded-xl">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">{app.job_title || "Untitled application"}</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {[companyName, app.location].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Applied {formatDate(app.date_submitted)}
            {app.status_changed_at ? ` · updated ${formatDate(app.status_changed_at)}` : ""}
            {saveState === "saving" ? " · saving…" : saveState === "saved" ? " · saved ✓" : saveState === "error" ? " · not saved" : ""}
          </p>
        </div>
        <button onClick={onClose} className="btn-ghost -mr-2 -mt-1 px-2 py-1 text-lg leading-none" aria-label="Close">
          ×
        </button>
      </div>

      {/* Status — one tap */}
      <section>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                app.status === s
                  ? `${STATUS_BADGE_CLASSES[s]} ring-2 ring-offset-1 ring-current`
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      {/* Follow-up nudge */}
      {waiting !== null && (
        <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="text-amber-900">
            <strong>No reply in {waiting} days.</strong> A short check-in often gets things moving.
          </p>
          <a
            href={gmailComposeLink(applicationEmail, `Following up: ${app.job_title || "my application"}`, followUpBody)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block font-medium text-amber-800 underline"
          >
            Draft a follow-up in Gmail ↗
          </a>
        </section>
      )}

      {/* Next steps */}
      <section className="mt-5 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Next steps</p>
        {scheduling ? (
          <ScheduleInterview
            variant="inline"
            applicationId={app.id}
            onClose={() => setScheduling(false)}
            onSaved={() => {
              setScheduling(false);
              load();
              onChanged();
            }}
          />
        ) : (
          <button onClick={() => setScheduling(true)} className="btn-primary w-full">
            Schedule call / interview…
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <GenerateButton label="Company brief" applicationId={app.id} type="company_brief" onDone={load} />
          <GenerateButton label="Interview prep" applicationId={app.id} type="interview_prep" onDone={load} />
        </div>
      </section>

      {/* Interviews */}
      {interviews.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-neutral-700">Interviews</h3>
          <ul className="space-y-1.5 text-sm">
            {interviews.map((iv) => (
              <li key={iv.id} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
                <span>
                  {formatDateTime(iv.scheduled_at)}
                  {iv.type ? ` · ${iv.type}` : ""}
                  {iv.location_text ? ` · ${iv.location_text}` : ""}
                </span>
                {iv.ics_sent_at && <span title="Invite sent">📨</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Documents */}
      <section className="mt-5">
        <h3 className="mb-2 text-sm font-semibold text-neutral-700">Documents</h3>
        {documents.length === 0 ? (
          <p className="text-sm text-neutral-400">None yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
                <span className="min-w-0 truncate">
                  {DOC_LABELS[doc.type] ?? doc.type} <span className="text-xs text-neutral-400">v{doc.version}</span>
                  {doc.generation_notes && (
                    <span className="block truncate text-xs text-neutral-400" title={doc.generation_notes}>
                      “{doc.generation_notes}”
                    </span>
                  )}
                </span>
                <a className="shrink-0 text-xs font-medium text-accent-600 hover:underline" href={`/api/documents/${doc.id}/download`}>
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Email thread */}
      <EmailThread
        applicationId={app.id}
        emails={emails}
        summary={summary}
        onPasted={(newSummary) => {
          if (newSummary !== undefined) setSummary(newSummary);
          load();
        }}
      />

      {/* Details — folded away, saved as you go */}
      <details className="mt-6 rounded-lg border border-neutral-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-neutral-700">Job details</summary>
        <div className="mt-3 space-y-3">
          <Text label="Job title" value={app.job_title}
            onChange={(v) => setApp((p) => ({ ...p, job_title: v }))} onBlur={() => saveIfChanged("job_title")} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Company</label>
              <select className="input" value={app.company_id ?? ""}
                onChange={(e) => commit({ company_id: e.target.value || null })}>
                <option value="">—</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Date applied</label>
              <input type="date" className="input" value={app.date_submitted ?? ""}
                onChange={(e) => commit({ date_submitted: e.target.value || null })} />
            </div>
            <Text label="Salary" value={app.salary_text ?? ""}
              onChange={(v) => setApp((p) => ({ ...p, salary_text: v }))} onBlur={() => saveIfChanged("salary_text")} />
            <Text label="Location" value={app.location ?? ""}
              onChange={(v) => setApp((p) => ({ ...p, location: v }))} onBlur={() => saveIfChanged("location")} />
          </div>
          <Text label="Job advert URL" value={app.job_url ?? ""}
            onChange={(v) => setApp((p) => ({ ...p, job_url: v }))} onBlur={() => saveIfChanged("job_url")} />
          <div>
            <label className="label">Notes</label>
            <textarea className="input min-h-16" value={app.notes ?? ""}
              onChange={(e) => setApp((p) => ({ ...p, notes: e.target.value }))} onBlur={() => saveIfChanged("notes")} />
          </div>
          <div>
            <label className="label">Job description</label>
            <textarea className="input min-h-24" value={app.job_description_text ?? ""}
              onChange={(e) => setApp((p) => ({ ...p, job_description_text: e.target.value }))}
              onBlur={() => saveIfChanged("job_description_text")} />
          </div>
        </div>
      </details>
    </aside>
  );
}

function Text({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
  );
}

function GenerateButton({
  label,
  applicationId,
  type,
  onDone,
}: {
  label: string;
  applicationId: string;
  type: "company_brief" | "interview_prep";
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/documents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: applicationId, type }),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Generation failed");
      return;
    }
    onDone();
  }

  return (
    <div>
      <button onClick={generate} disabled={busy} className="btn-secondary w-full text-xs">
        {busy ? "Generating…" : `${label} (PDF)`}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function EmailThread({
  applicationId,
  emails,
  summary,
  onPasted,
}: {
  applicationId: string;
  emails: ApplicationEmail[];
  summary: string | null;
  onPasted: (summary?: string) => void;
}) {
  const [body, setBody] = useState("");
  const [direction, setDirection] = useState<"from_me" | "from_company">("from_company");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function paste(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: applicationId, direction, body_text: body }),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to save email");
      return;
    }
    const json = await res.json();
    setBody("");
    onPasted(json.summary);
  }

  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-semibold text-neutral-700">Email thread</h3>
      {summary && (
        <div className="mb-3 rounded-lg border border-accent-200 bg-accent-50 p-3 text-xs leading-relaxed text-accent-700">
          <p className="mb-1 font-semibold">AI summary</p>
          <p className="whitespace-pre-wrap">{summary}</p>
        </div>
      )}
      <form onSubmit={paste} className="space-y-2">
        <textarea className="input min-h-20 text-xs" placeholder="Paste an email here…" value={body}
          onChange={(e) => setBody(e.target.value)} required />
        <div className="flex items-center justify-between gap-2">
          <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
            <button type="button" onClick={() => setDirection("from_company")}
              className={`px-2.5 py-1.5 ${direction === "from_company" ? "bg-accent-600 text-white" : "bg-white text-neutral-600"}`}>
              From company
            </button>
            <button type="button" onClick={() => setDirection("from_me")}
              className={`px-2.5 py-1.5 ${direction === "from_me" ? "bg-accent-600 text-white" : "bg-white text-neutral-600"}`}>
              From me
            </button>
          </div>
          <button type="submit" disabled={busy} className="btn-primary text-xs">
            {busy ? "Saving…" : "Add email"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
      <ul className="mt-3 space-y-2">
        {emails.map((em) => (
          <li key={em.id}
            className={`rounded-lg border p-3 text-xs leading-relaxed ${em.direction === "from_me" ? "border-neutral-200 bg-white" : "border-neutral-200 bg-neutral-50"}`}>
            <p className="mb-1 flex justify-between font-medium text-neutral-500">
              <span>{em.direction === "from_me" ? "Me → company" : "Company → me"}</span>
              <span>{formatDateTime(em.pasted_at)}</span>
            </p>
            <p className="whitespace-pre-wrap text-neutral-700">{em.body_text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
