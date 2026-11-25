"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { TrackerRow } from "@/lib/sort";
import type { ApplicationStatus, Company } from "@/lib/types";
import { STATUS_LABELS, STATUS_BADGE_CLASSES, formatDate, formatDateTime } from "@/lib/labels";
import { ApplicationDetail } from "@/components/application-detail";
import { ScheduleInterview } from "@/components/schedule-interview";
import Link from "next/link";

const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as ApplicationStatus[];

// Sortable columns for the Applied table. Each returns a comparable value
// (string for text, number for dates/status order); null/empty sorts last.
type SortKey =
  | "applied"
  | "job_title"
  | "company"
  | "salary"
  | "status"
  | "notes"
  | "location"
  | "next_interview";

const SORT_VALUE: Record<SortKey, (r: TrackerRow) => string | number | null> = {
  applied: (r) => (r.date_submitted ? Date.parse(r.date_submitted) : null),
  job_title: (r) => r.job_title?.toLowerCase() || null,
  company: (r) => r.company_name?.toLowerCase() || null,
  salary: (r) => r.salary_text?.toLowerCase() || null,
  status: (r) => STATUS_OPTIONS.indexOf(r.status),
  notes: (r) => r.notes?.toLowerCase() || null,
  location: (r) => r.location?.toLowerCase() || null,
  next_interview: (r) => (r.next_interview_at ? Date.parse(r.next_interview_at) : null),
};

export function TrackerClient({
  toApplyCount,
  applied,
  rejected,
  companies,
  initialOpenId = null,
}: {
  toApplyCount: number;
  applied: TrackerRow[];
  rejected: TrackerRow[];
  companies: Company[];
  initialOpenId?: string | null; // ?open=<id> — open that application's panel
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initialOpenId);
  const [showRejected, setShowRejected] = useState(
    !!initialOpenId && rejected.some((r) => r.id === initialOpenId)
  );
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  // Click a header to sort by it; click again to flip direction. With no sort
  // chosen, the default (sortTrackerRows) order from the server is kept.
  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur?.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  const sortedApplied = useMemo(() => {
    if (!sort) return applied;
    const get = SORT_VALUE[sort.key];
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...applied].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // nulls always last
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb)) * factor;
    });
  }, [applied, sort]);

  const selected =
    applied.find((r) => r.id === selectedId) ??
    rejected.find((r) => r.id === selectedId) ??
    null;

  async function updateStatus(id: string, status: ApplicationStatus) {
    const supabase = createClient();
    const patch: Record<string, unknown> = {
      status,
      status_changed_at: new Date().toISOString(),
    };
    if (status === "applied") {
      patch.date_submitted = new Date().toISOString().slice(0, 10);
    }
    await supabase.from("applications").update(patch).eq("id", id);
    router.refresh();
  }

  function Row({ row }: { row: TrackerRow }) {
    return (
      <tr
        onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}
        className={`cursor-pointer border-t border-neutral-100 transition-colors hover:bg-neutral-50 ${
          row.id === selectedId ? "bg-accent-50/60" : ""
        }`}
      >
        <td className="whitespace-nowrap px-3 py-2.5 text-neutral-500">
          {formatDate(row.date_submitted)}
        </td>
        <td className="px-3 py-2.5 font-medium text-neutral-900">{row.job_title || "Untitled"}</td>
        <td className="px-3 py-2.5">{row.company_name ?? "—"}</td>
        <td className="px-3 py-2.5 text-neutral-500">{row.salary_text ?? "—"}</td>
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <select
            value={row.status}
            onChange={(e) => updateStatus(row.id, e.target.value as ApplicationStatus)}
            className={`cursor-pointer rounded-full border-0 py-0.5 pl-2.5 pr-7 text-xs font-medium focus:ring-2 focus:ring-accent-200 ${STATUS_BADGE_CLASSES[row.status]}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {row.status_changed_at && (
            <div className="mt-1 text-[10px] text-neutral-400">
              {formatDate(row.status_changed_at)}
            </div>
          )}
        </td>
        <td className="max-w-40 truncate px-3 py-2.5 text-neutral-500" title={row.notes ?? ""}>
          {row.notes ?? ""}
        </td>
        <td className="px-3 py-2.5 text-neutral-500">{row.location ?? "—"}</td>
        <td className="whitespace-nowrap px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          {row.next_interview_at ? (
            <span className="badge bg-green-50 text-green-700">
              {formatDateTime(row.next_interview_at)}
            </span>
          ) : (
            <div className="relative">
              <button
                onClick={() => setSchedulingId(schedulingId === row.id ? null : row.id)}
                className="text-xs font-medium text-accent-600 hover:underline"
              >
                Schedule…
              </button>
              {schedulingId === row.id && (
                <ScheduleInterview
                  applicationId={row.id}
                  onClose={() => setSchedulingId(null)}
                  onSaved={() => {
                    setSchedulingId(null);
                    router.refresh();
                  }}
                />
              )}
            </div>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Applied</h1>
        <span className="text-sm text-neutral-500">
          {toApplyCount} to apply · {applied.length} applied · {rejected.length} rejected
        </span>
      </div>

      {/* Jobs not yet applied for live in Jobs, where each opens ready to apply. */}
      {toApplyCount > 0 && (
        <Link
          href="/jobs"
          className="flex items-center justify-between rounded-xl border border-sky-300 bg-sky-50 px-5 py-3 text-sm text-sky-900 hover:bg-sky-100"
        >
          <span>
            <strong>{toApplyCount}</strong> job{toApplyCount === 1 ? "" : "s"} waiting to be applied for
          </span>
          <span className="font-semibold">Go to Jobs →</span>
        </Link>
      )}

      {/* ---------- Applied: the tracker ---------- */}
      <section className="rounded-2xl border border-blue-300 bg-blue-100/60 p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-blue-900">Applied</h2>
            <p className="text-sm text-neutral-500">
              Jobs you&apos;ve applied for. Open a row to add emails and generate interview prep.
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {applied.length}
          </span>
        </div>

        <div className="flex gap-6">
          <div className="min-w-0 flex-1">
            <div className="card overflow-x-auto lg:overflow-visible">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <SortableHeader label="Applied" sortKey="applied" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Job title" sortKey="job_title" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Company" sortKey="company" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Salary" sortKey="salary" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Notes" sortKey="notes" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Location" sortKey="location" sort={sort} onSort={toggleSort} />
                    <SortableHeader label="Next interview" sortKey="next_interview" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedApplied.map((row) => (
                    <Row key={row.id} row={row} />
                  ))}
                  {applied.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-neutral-400">
                        No applications yet — tailor a job above and mark it applied.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Rejected: collapsed at the very bottom */}
            <div className="mt-6">
              <button
                onClick={() => setShowRejected(!showRejected)}
                className="flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-800"
              >
                <span className={`transition-transform ${showRejected ? "rotate-90" : ""}`}>▸</span>
                Rejected ({rejected.length})
              </button>
              {showRejected && rejected.length > 0 && (
                <div className="card mt-3 overflow-x-auto opacity-75">
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {rejected.map((row) => (
                        <Row key={row.id} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Expansion panel to the right */}
          {selected && (
            <ApplicationDetail
              key={selected.id}
              application={selected}
              companies={companies}
              onClose={() => setSelectedId(null)}
              onChanged={() => router.refresh()}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className="px-3 py-2.5 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-neutral-700 ${
          active ? "text-neutral-700" : ""
        }`}
        title={`Sort by ${label}`}
      >
        {label}
        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`}>
          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </button>
    </th>
  );
}

