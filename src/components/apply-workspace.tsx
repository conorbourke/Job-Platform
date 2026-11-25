"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AttachmentsSection } from "@/components/attachments-section";
import { FormCompletion } from "@/components/form-completion";
import { SuitabilityBadge } from "@/components/suitability-badge";
import {
  deadlineLabel,
  gmailComposeLink,
  mailtoLink,
  wordCount,
} from "@/lib/apply";
import { formatDateTime } from "@/lib/labels";
import type { Application, Company, CvTemplate, FormSubmission } from "@/lib/types";

export interface GeneratedPair {
  cvDocId: string;
  coverDocId: string;
  emailSubject: string;
  emailBody: string;
  applicationEmail: string;
  version: number;
  createdAt: string;
}

export interface QueueInfo {
  position: number; // 0 when this job isn't in the queue
  total: number;
  nextId: string | null;
  prevId: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * One job, start to finish: a summary of the job (details folded away and
 * autosaved), then three steps — ① tailor the CV & cover letter, ② send it
 * (prefilled email or the online form), ③ mark it applied and move straight on
 * to the next job in the queue.
 */
export function ApplyWorkspace({
  application,
  companies: initialCompanies,
  cvTemplates,
  initialDocs,
  initialSubmission,
  queue,
  priorRoles,
  today,
  justApplied = false,
}: {
  application: Application;
  companies: Company[];
  cvTemplates: CvTemplate[];
  initialDocs: GeneratedPair | null;
  initialSubmission: FormSubmission | null;
  queue: QueueInfo;
  priorRoles: string[];
  today: string; // YYYY-MM-DD, from the server so server and browser agree
  justApplied?: boolean; // arrived here straight after marking the previous job applied
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [app, setApp] = useState(application);
  const appRef = useRef(app);
  appRef.current = app;
  const savedRef = useRef<Application>(application); // last values written to the DB
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState(initialCompanies);
  const [companyName, setCompanyName] = useState(
    initialCompanies.find((c) => c.id === application.company_id)?.name ?? ""
  );
  const [showDetails, setShowDetails] = useState(!application.job_title);
  const [showJd, setShowJd] = useState(!application.job_description_text?.trim());

  const [docs, setDocs] = useState<GeneratedPair | null>(initialDocs);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const master = cvTemplates.find((t) => t.is_master);
  const [templateId, setTemplateId] = useState(master?.id ?? cvTemplates[0]?.id ?? "");
  const [aiNotes, setAiNotes] = useState("");
  const [regenComment, setRegenComment] = useState("");

  const [rereading, setRereading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [appliedDate, setAppliedDate] = useState(today);
  const [finishing, setFinishing] = useState(false);

  const company = companies.find((c) => c.id === app.company_id);
  const deadline = deadlineLabel(app.due_date, today);
  const words = wordCount(app.job_description_text);

  // ---------------------------------------------------------------- saving --

  /** Write fields to the database, one save at a time, in order. */
  function persist(fields: Partial<Application>) {
    setSaveState("saving");
    const run = pending.current.then(async () => {
      const { error } = await supabase.from("applications").update(fields).eq("id", app.id);
      if (error) {
        setSaveState("error");
        setError(`Couldn't save: ${error.message}`);
        return;
      }
      savedRef.current = { ...savedRef.current, ...fields };
      setSaveState("saved");
    });
    pending.current = run.catch(() => {});
    return run;
  }

  /** Update locally and save straight away (selects, dates, checkboxes). */
  function commit(fields: Partial<Application>) {
    setApp((prev) => ({ ...prev, ...fields }));
    return persist(fields);
  }

  /** Save a text field when you leave it — only if it actually changed. */
  function saveIfChanged<K extends keyof Application>(key: K) {
    const value = appRef.current[key];
    if (value === savedRef.current[key]) return;
    persist({ [key]: value } as Partial<Application>);
  }

  // Leaving the page with a field still focused: flush it.
  useEffect(() => {
    return () => {
      const a = appRef.current;
      const s = savedRef.current;
      const changed: Partial<Application> = {};
      for (const k of ["job_title", "salary_text", "location", "job_url", "notes", "job_description_text"] as const) {
        if (a[k] !== s[k]) (changed as Record<string, unknown>)[k] = a[k];
      }
      if (Object.keys(changed).length) {
        void supabase.from("applications").update(changed).eq("id", a.id);
      }
    };
  }, [supabase]);

  async function resolveCompany() {
    const name = companyName.trim();
    if (!name) {
      if (app.company_id) commit({ company_id: null });
      return;
    }
    const match = companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (match) {
      setCompanyName(match.name);
      if (match.id !== app.company_id) commit({ company_id: match.id });
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: created, error } = await supabase
      .from("companies")
      .insert({ user_id: user!.id, name, tier: "secondary" })
      .select()
      .single<Company>();
    if (error || !created) {
      setError(`Couldn't add company: ${error?.message ?? "unknown error"}`);
      return;
    }
    setCompanies((prev) => [...prev, created]);
    commit({ company_id: created.id });
  }

  // ------------------------------------------------------- job description --

  async function rereadFromUrl() {
    if (!app.job_url) return;
    setRereading(true);
    setError(null);
    await pending.current;
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: app.id, url: app.job_url }),
    });
    const json = await res.json().catch(() => ({}));
    setRereading(false);
    if (!res.ok) {
      setError(json.error ?? "Couldn't re-read the job page.");
      return;
    }
    const fresh = json.application as Application;
    setApp((prev) => ({
      ...prev,
      job_description_text: fresh.job_description_text,
      job_title: prev.job_title || fresh.job_title,
      location: prev.location || fresh.location,
      salary_text: prev.salary_text || fresh.salary_text,
      company_id: prev.company_id || fresh.company_id,
      job_url: fresh.job_url,
    }));
    savedRef.current = { ...savedRef.current, ...fresh };
  }

  async function onJdFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/extract-text", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setExtracting(false);
    if (!res.ok) {
      setError(json.error ?? "Couldn't read that file.");
      return;
    }
    commit({ job_description_text: json.text });
  }

  // ------------------------------------------------------------- tailoring --

  async function generate(regeneration: boolean) {
    setGenerating(true);
    setGenError(null);
    await pending.current; // the AI must see your latest edits
    const res = await fetch("/api/generate/cv-cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application_id: app.id,
        cv_template_id: templateId,
        notes: aiNotes,
        regeneration_comment: regeneration ? regenComment : undefined,
        attach_portfolio: app.attach_portfolio,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setGenerating(false);
    if (!res.ok) {
      setGenError(json.error ?? "Generation failed. Please try again.");
      return;
    }
    setDocs({
      cvDocId: json.cv.id,
      coverDocId: json.cover.id,
      emailSubject: json.email_subject ?? "",
      emailBody: json.email_body ?? "",
      applicationEmail: json.application_email ?? "",
      version: json.cv.version ?? (docs?.version ?? 0) + 1,
      createdAt: json.cv.created_at ?? new Date().toISOString(),
    });
    setRegenComment("");
  }

  function downloadBoth() {
    if (!docs) return;
    // Two files, slightly apart so the browser treats them as separate downloads.
    [docs.cvDocId, docs.coverDocId].forEach((id, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = `/api/documents/${id}/download`;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 900);
    });
  }

  // ------------------------------------------------------------- finishing --

  async function markApplied() {
    setFinishing(true);
    setError(null);
    await pending.current;
    const { error } = await supabase
      .from("applications")
      .update({
        status: "applied",
        date_submitted: appliedDate || today,
        status_changed_at: new Date().toISOString(),
      })
      .eq("id", app.id);
    if (error) {
      setFinishing(false);
      setError(`Couldn't mark as applied: ${error.message}`);
      return;
    }
    router.push(queue.nextId ? `/jobs/${queue.nextId}?applied=1` : "/jobs?done=1");
    router.refresh();
  }

  function skip() {
    router.push(queue.nextId ? `/jobs/${queue.nextId}` : "/jobs");
  }

  async function remove() {
    if (!window.confirm("Delete this job? This can't be undone.")) return;
    await supabase.from("applications").delete().eq("id", app.id);
    router.push(queue.nextId ? `/jobs/${queue.nextId}` : "/jobs");
    router.refresh();
  }

  const isWebForm = app.application_type === "web_form";

  // ----------------------------------------------------------------- render --

  return (
    <div className="max-w-3xl space-y-5">
      {/* Queue navigation */}
      <div className="flex items-center justify-between text-sm">
        <Link href="/jobs" className="font-medium text-neutral-500 hover:text-neutral-900">
          ← Jobs
        </Link>
        <div className="flex items-center gap-4">
          {queue.position > 0 && (
            <span className="text-neutral-400">
              Job {queue.position} of {queue.total}
            </span>
          )}
          {queue.nextId && (
            <button onClick={skip} className="font-medium text-neutral-500 hover:text-neutral-900">
              Skip for now →
            </button>
          )}
        </div>
      </div>

      {justApplied && (
        <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">
          ✓ Applied — that one&apos;s in Applied now. Here&apos;s the next job.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}{" "}
          <button className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}

      {/* ------------------------------------------------------ Job summary */}
      <section className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
              {app.job_title || "Untitled job"}
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              {[company?.name, app.location, app.salary_text].filter(Boolean).join(" · ") ||
                "Add the company, location and salary under Edit details"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  deadline.tone === "past"
                    ? "bg-red-50 text-red-700"
                    : deadline.tone === "soon"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {deadline.text}
              </span>
              <SuitabilityBadge value={app.suitability} reason={app.suitability_reason} />
              {priorRoles.length > 0 && (
                <span
                  className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700"
                  title={`You've applied here before for: ${priorRoles.join(", ")}`}
                >
                  Applied here before
                </span>
              )}
            </div>
            {app.suitability_reason && (
              <p className="mt-2 text-xs text-neutral-500">{app.suitability_reason}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 text-sm">
            {app.job_url && (
              <a
                href={app.job_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent-600 hover:underline"
              >
                View advert ↗
              </a>
            )}
            <SaveIndicator state={saveState} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 border-t border-neutral-100 pt-3 text-sm">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="font-medium text-neutral-600 hover:text-neutral-900"
          >
            {showDetails ? "▾" : "▸"} Edit details
          </button>
          <button
            onClick={() => setShowJd(!showJd)}
            className="font-medium text-neutral-600 hover:text-neutral-900"
          >
            {showJd ? "▾" : "▸"} Job description
            <span className="ml-1 font-normal text-neutral-400">
              {words ? `· ${words.toLocaleString()} words` : "· missing"}
            </span>
          </button>
          <button onClick={remove} className="ml-auto text-xs text-neutral-400 hover:text-red-600">
            Delete job
          </button>
        </div>

        {showDetails && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <TextField label="Job title" value={app.job_title}
              onChange={(v) => setApp((p) => ({ ...p, job_title: v }))}
              onBlur={() => saveIfChanged("job_title")} />
            <div>
              <label className="label">Company</label>
              <input className="input" list="apply-companies" value={companyName}
                placeholder="Type to pick or add a company"
                onChange={(e) => setCompanyName(e.target.value)}
                onBlur={resolveCompany} />
              <datalist id="apply-companies">
                {companies.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
            <TextField label="Location" value={app.location ?? ""}
              onChange={(v) => setApp((p) => ({ ...p, location: v }))}
              onBlur={() => saveIfChanged("location")} />
            <TextField label="Salary" value={app.salary_text ?? ""}
              onChange={(v) => setApp((p) => ({ ...p, salary_text: v }))}
              onBlur={() => saveIfChanged("salary_text")} />
            <div>
              <label className="label">Application deadline</label>
              <input type="date" className="input" value={app.due_date ?? ""}
                onChange={(e) => commit({ due_date: e.target.value || null })} />
            </div>
            <TextField label="Job advert URL" value={app.job_url ?? ""}
              onChange={(v) => setApp((p) => ({ ...p, job_url: v }))}
              onBlur={() => saveIfChanged("job_url")} />
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea className="input min-h-16" value={app.notes ?? ""}
                onChange={(e) => setApp((p) => ({ ...p, notes: e.target.value }))}
                onBlur={() => saveIfChanged("notes")} />
            </div>
          </div>
        )}

        {showJd && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label className="label">Job description</label>
              <div className="flex items-center gap-3 text-xs font-medium text-accent-600">
                {app.job_url && (
                  <button type="button" onClick={rereadFromUrl} disabled={rereading}
                    className="hover:underline disabled:opacity-50"
                    title="Fetch the advert again and replace this with the full posting text">
                    {rereading ? "Reading page…" : "Re-read from job URL"}
                  </button>
                )}
                <label className="cursor-pointer hover:underline">
                  {extracting ? "Extracting…" : "Upload file"}
                  <input type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={onJdFile} />
                </label>
              </div>
            </div>
            {!words && (
              <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                No job description yet — paste it in (or re-read it from the advert) so your CV can be tailored to it.
              </p>
            )}
            <textarea className="input min-h-48 text-sm" value={app.job_description_text ?? ""}
              onChange={(e) => setApp((p) => ({ ...p, job_description_text: e.target.value }))}
              onBlur={() => saveIfChanged("job_description_text")} />
            <AttachmentsSection applicationId={app.id} />
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ ① Tailor */}
      <Step n={1} title="Tailor your CV & cover letter" done={!!docs}>
        {cvTemplates.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
            Set up your master CV in <Link href="/templates" className="underline">CV Templates</Link> first.
          </p>
        ) : !docs ? (
          <div>
            <button onClick={() => generate(false)} disabled={generating} className="btn-primary">
              {generating ? "Writing your CV & cover letter…" : "Generate CV & cover letter"}
            </button>
            {generating && (
              <p className="mt-2 text-xs text-neutral-500">This usually takes about a minute.</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-green-700">
              ✓ Ready — version {docs.version}, made {formatDateTime(docs.createdAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={`/api/documents/${docs.cvDocId}/download`} className="btn-secondary">⬇ CV</a>
              <a href={`/api/documents/${docs.coverDocId}/download`} className="btn-secondary">⬇ Cover letter</a>
              <a href={`/api/documents/${docs.cvDocId}/download?inline=1`} target="_blank" rel="noreferrer"
                className="btn-ghost text-sm">Preview CV ↗</a>
              <a href={`/api/documents/${docs.coverDocId}/download?inline=1`} target="_blank" rel="noreferrer"
                className="btn-ghost text-sm">Preview letter ↗</a>
            </div>
            <div>
              <label className="label">Not quite right? Say what to change</label>
              <div className="flex gap-2">
                <input className="input" value={regenComment}
                  placeholder="e.g. lead with events experience, shorter About Me"
                  onChange={(e) => setRegenComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && regenComment.trim() && !generating) generate(true);
                  }} />
                <button onClick={() => generate(true)} disabled={generating || !regenComment.trim()}
                  className="btn-secondary shrink-0">
                  {generating ? "Rewriting…" : "Regenerate"}
                </button>
              </div>
            </div>
          </div>
        )}
        {genError && <p className="mt-2 text-sm text-red-600">{genError}</p>}

        {cvTemplates.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowOptions(!showOptions)}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
              {showOptions ? "▾" : "▸"} Options
            </button>
            {showOptions && (
              <div className="mt-2 grid gap-3 rounded-lg bg-neutral-50 p-3 sm:grid-cols-2">
                <div>
                  <label className="label">CV template</label>
                  <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {cvTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.is_master ? `${t.label} (master)` : t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Anything the AI should use</label>
                  <input className="input" placeholder="Optional" value={aiNotes}
                    onChange={(e) => setAiNotes(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600"
                    checked={app.attach_portfolio}
                    onChange={(e) => commit({ attach_portfolio: e.target.checked })} />
                  Mention my portfolio (websites & admin systems built) in the letter and email
                </label>
              </div>
            )}
          </div>
        )}
      </Step>

      {/* ------------------------------------------------------ ② Send */}
      <Step n={2} title="Send your application" muted={!docs}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-500">How do you apply?</span>
          <div className="flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
            {(
              [
                ["email", "By email"],
                ["web_form", "Online form"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button"
                onClick={() => app.application_type !== value && commit({ application_type: value })}
                className={`px-3 py-1.5 ${app.application_type === value ? "bg-accent-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {!docs && (
          <p className="text-sm text-neutral-500">Generate your CV & cover letter first (step 1).</p>
        )}

        {docs && !isWebForm && (
          <div className="space-y-3">
            {docs.applicationEmail ? (
              <p className="text-sm">
                <span className="text-neutral-500">Send to </span>
                <span className="font-medium text-neutral-900">{docs.applicationEmail}</span>
                <span className="text-neutral-400"> (from the advert)</span>
              </p>
            ) : (
              <p className="text-sm text-neutral-500">
                The advert didn&apos;t give an email address — check it and fill in the “To” line.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadBoth} className="btn-secondary">⬇ Download both PDFs</button>
              <a className="btn-primary" target="_blank" rel="noreferrer"
                href={gmailComposeLink(docs.applicationEmail, docs.emailSubject, docs.emailBody)}>
                ✉ Open in Gmail
              </a>
              <a className="btn-secondary"
                href={mailtoLink(docs.applicationEmail, docs.emailSubject, docs.emailBody)}>
                Open in Mail app
              </a>
            </div>
            <p className="text-xs text-neutral-500">
              The email opens with the subject and message filled in — attach the two PDFs you just
              downloaded and press send.
            </p>
            <details className="rounded-lg border border-neutral-200 p-3">
              <summary className="cursor-pointer text-xs font-medium text-neutral-600">
                Show the email text
              </summary>
              <div className="mt-3 space-y-3">
                <CopyField label="Subject" value={docs.emailSubject} />
                <CopyField label="Message" value={docs.emailBody} multiline />
              </div>
            </details>
          </div>
        )}

        {docs && isWebForm && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {app.job_url ? (
                <a href={app.job_url} target="_blank" rel="noreferrer" className="btn-primary">
                  Open the application page ↗
                </a>
              ) : (
                <span className="text-sm text-neutral-500">Add the advert URL under Edit details to open the form from here.</span>
              )}
              <button onClick={downloadBoth} className="btn-secondary">⬇ Download both PDFs</button>
            </div>
            <p className="text-xs text-neutral-500">
              Upload the two PDFs on the employer&apos;s site. If the form has written questions, the
              assistant below can draft the answers.
            </p>
          </div>
        )}

        {isWebForm && (
          <details className="mt-3 rounded-lg border border-neutral-200 p-3" open={!!initialSubmission}>
            <summary className="cursor-pointer text-xs font-medium text-neutral-600">
              Help me answer the form&apos;s questions
            </summary>
            <FormCompletion application={app} initialSubmission={initialSubmission} />
          </details>
        )}
      </Step>

      {/* ------------------------------------------------------ ③ Done */}
      <Step n={3} title="Done? Mark it applied">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={markApplied} disabled={finishing}
            className={docs ? "btn-primary" : "btn-secondary"}>
            {finishing ? "Saving…" : queue.nextId ? "✓ I've applied — next job" : "✓ I've applied"}
          </button>
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            Applied on
            <input type="date" className="input w-auto py-1 text-xs" value={appliedDate}
              max={today} onChange={(e) => setAppliedDate(e.target.value)} />
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          It moves to Applied, where you can track replies and prep for interviews.
        </p>
      </Step>
    </div>
  );
}

/* ------------------------------------------------------------------ parts -- */

function Step({
  n,
  title,
  done,
  muted,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`card p-5 ${muted ? "opacity-80" : ""}`}>
      <h2 className="mb-3 flex items-center gap-3 text-base font-semibold">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${
            done ? "bg-green-100 text-green-700" : "bg-accent-50 text-accent-700"
          }`}
        >
          {done ? "✓" : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function TextField({
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

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const text = { saving: "Saving…", saved: "Saved ✓", error: "Not saved" }[state];
  const tone = { saving: "text-neutral-400", saved: "text-green-600", error: "text-red-600" }[state];
  return <span className={`text-xs ${tone}`}>{text}</span>;
}

function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label">{label}</label>
        <button onClick={copy} className="text-xs font-medium text-accent-600 hover:underline">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      {multiline ? (
        <pre className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 font-sans text-sm text-neutral-700">{value}</pre>
      ) : (
        <p className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700">{value}</p>
      )}
    </div>
  );
}
