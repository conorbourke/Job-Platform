"use client";

import { useState } from "react";

/**
 * Schedule a call or interview: saves it, then (per Settings) generates the
 * company brief + interview prep and emails a calendar invite. Shown as a
 * floating popover in the Applied table, or inline in the application panel.
 */
export function ScheduleInterview({
  applicationId,
  onClose,
  onSaved,
  variant = "popover",
}: {
  applicationId: string;
  onClose: () => void;
  onSaved: () => void;
  variant?: "popover" | "inline";
}) {
  const box =
    variant === "popover"
      ? "absolute right-0 top-6 z-20 w-72 shadow-lg"
      : "w-full";
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState("video");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application_id: applicationId,
        scheduled_at: new Date(`${date}T${time}`).toISOString(),
        location_text: location,
        type,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to schedule");
      return;
    }
    const json = await res.json();
    if (json.warnings?.length) {
      // Interview saved, but a follow-up step had issues — let the user read them.
      setWarnings(json.warnings);
      return;
    }
    onSaved();
  }

  if (warnings) {
    return (
      <div
        className={`${box} space-y-3 rounded-xl border border-amber-200 bg-white p-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-amber-700">Scheduled, with warnings</p>
        <ul className="list-disc pl-4 text-xs text-neutral-600">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
        <button onClick={onSaved} className="btn-secondary w-full">
          OK
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={save}
      className={`${box} space-y-3 rounded-xl border border-neutral-200 bg-white p-4`}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-sm font-semibold">Schedule call / interview</p>
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Date</label>
          <input type="date" required className="input" value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Time</label>
          <input type="time" required className="input" value={time}
            onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="phone">Phone</option>
          <option value="video">Video</option>
          <option value="in_person">In person</option>
        </select>
      </div>
      <div>
        <label className="label">Location / medium</label>
        <input className="input" placeholder="e.g. Zoom link, office address" value={location}
          onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          {busy ? "Saving…" : "Save & send invite"}
        </button>
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancel
        </button>
      </div>
      <p className="text-[11px] leading-snug text-neutral-400">
        Saving generates the company brief & interview prep PDFs and emails you
        a calendar invite with both attached (configurable in Settings).
      </p>
    </form>
  );
}
