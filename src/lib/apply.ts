/**
 * Pure helpers for the Apply workflow (queue order, deadline wording, email
 * links). Kept free of React/Supabase so they're unit-testable.
 */
import type { Suitability } from "./types";

export interface QueueItem {
  id: string;
  due_date: string | null;
  suitability: Suitability | null;
  created_at: string;
}

const MATCH_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * The order jobs are worked through: unknown deadline first (so they get
 * checked), then soonest deadline, then best match, then newest.
 */
export function sortQueue<T extends QueueItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (!a.due_date !== !b.due_date) return a.due_date ? 1 : -1;
    if (a.due_date && b.due_date && a.due_date !== b.due_date) {
      return a.due_date < b.due_date ? -1 : 1;
    }
    const ma = MATCH_RANK[a.suitability ?? ""] ?? 3;
    const mb = MATCH_RANK[b.suitability ?? ""] ?? 3;
    if (ma !== mb) return ma - mb;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** Position of `id` in an ordered queue, plus its neighbours. */
export function queuePosition(ids: string[], id: string) {
  const i = ids.indexOf(id);
  return {
    position: i + 1, // 0 when not in the queue
    total: ids.length,
    nextId: i >= 0 && i < ids.length - 1 ? ids[i + 1] : i < 0 ? ids[0] ?? null : null,
    prevId: i > 0 ? ids[i - 1] : null,
  };
}

/** Whole days from `today` (YYYY-MM-DD) to `date` (YYYY-MM-DD). */
export function daysUntil(date: string, today: string): number {
  const d = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.round((d - t) / 86_400_000);
}

/** "due today", "due tomorrow", "due in 5 days", "closed 2 days ago". */
export function deadlineLabel(due: string | null, today: string): { text: string; tone: "none" | "ok" | "soon" | "past" } {
  if (!due) return { text: "no deadline", tone: "none" };
  const n = daysUntil(due, today);
  if (n < 0) return { text: `closed ${-n} day${n === -1 ? "" : "s"} ago`, tone: "past" };
  if (n === 0) return { text: "due today", tone: "soon" };
  if (n === 1) return { text: "due tomorrow", tone: "soon" };
  return { text: `due in ${n} days`, tone: n <= 7 ? "soon" : "ok" };
}

/** mailto: link with the recipient, subject and message filled in. */
export function mailtoLink(to: string, subject: string, body: string): string {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  if (body) q.set("body", body);
  // URLSearchParams encodes spaces as "+", which mail apps show literally.
  const query = q.toString().replace(/\+/g, "%20");
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}${query ? `?${query}` : ""}`;
}

/** Gmail compose link with the recipient, subject and message filled in. */
export function gmailComposeLink(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ view: "cm", fs: "1" });
  if (to) q.set("to", to);
  if (subject) q.set("su", subject);
  if (body) q.set("body", body);
  return `https://mail.google.com/mail/?${q.toString()}`;
}

/** Word count, for "Job description · 1,120 words". Bullets ("-", "•") aren't words. */
export function wordCount(text: string | null | undefined): number {
  return (text ?? "").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}
