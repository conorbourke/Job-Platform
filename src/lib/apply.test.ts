import { describe, expect, it } from "vitest";
import {
  daysUntil,
  deadlineLabel,
  followUpDays,
  gmailComposeLink,
  mailtoLink,
  queuePosition,
  sortQueue,
  wordCount,
  type QueueItem,
} from "./apply";

const item = (id: string, due: string | null, match: QueueItem["suitability"], created = "2026-11-01"): QueueItem => ({
  id,
  due_date: due,
  suitability: match,
  created_at: created,
});

describe("sortQueue", () => {
  it("puts unknown deadlines first, then soonest deadline", () => {
    const out = sortQueue([
      item("late", "2026-12-20", "high"),
      item("none", null, "low"),
      item("soon", "2026-12-01", "low"),
    ]).map((i) => i.id);
    expect(out).toEqual(["none", "soon", "late"]);
  });
  it("breaks ties by match (high > medium > low > unrated), then newest", () => {
    const out = sortQueue([
      item("unrated", "2026-12-01", null),
      item("low", "2026-12-01", "low"),
      item("high", "2026-12-01", "high"),
      item("medium", "2026-12-01", "medium"),
      item("high-newer", "2026-12-01", "high", "2026-11-20"),
    ]).map((i) => i.id);
    expect(out).toEqual(["high-newer", "high", "medium", "low", "unrated"]);
  });
  it("doesn't mutate the input", () => {
    const input = [item("b", "2026-12-02", null), item("a", "2026-12-01", null)];
    sortQueue(input);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("queuePosition", () => {
  const ids = ["a", "b", "c"];
  it("gives position and neighbours", () => {
    expect(queuePosition(ids, "b")).toEqual({ position: 2, total: 3, nextId: "c", prevId: "a" });
    expect(queuePosition(ids, "c")).toEqual({ position: 3, total: 3, nextId: null, prevId: "b" });
  });
  it("points a job outside the queue at the start of it", () => {
    expect(queuePosition(ids, "x")).toEqual({ position: 0, total: 3, nextId: "a", prevId: null });
    expect(queuePosition([], "x")).toEqual({ position: 0, total: 0, nextId: null, prevId: null });
  });
});

describe("deadlines", () => {
  const today = "2026-11-25";
  it("counts whole days, across month ends", () => {
    expect(daysUntil("2026-12-01", today)).toBe(6);
    expect(daysUntil("2026-11-24", today)).toBe(-1);
  });
  it("words the deadline", () => {
    expect(deadlineLabel(null, today)).toEqual({ text: "no deadline", tone: "none" });
    expect(deadlineLabel("2026-11-25", today)).toEqual({ text: "due today", tone: "soon" });
    expect(deadlineLabel("2026-11-26", today)).toEqual({ text: "due tomorrow", tone: "soon" });
    expect(deadlineLabel("2026-12-01", today)).toEqual({ text: "due in 6 days", tone: "soon" });
    expect(deadlineLabel("2026-12-20", today)).toEqual({ text: "due in 25 days", tone: "ok" });
    expect(deadlineLabel("2026-11-24", today)).toEqual({ text: "closed 1 day ago", tone: "past" });
    expect(deadlineLabel("2026-11-20", today)).toEqual({ text: "closed 5 days ago", tone: "past" });
  });
});

describe("email links", () => {
  it("prefills a mailto link, with spaces and line breaks encoded properly", () => {
    const link = mailtoLink("jobs@stora.co", "Application: Operations Executive", "Dear Hiring Team,\n\nPlease find attached…");
    expect(link.startsWith("mailto:jobs@stora.co?")).toBe(true);
    expect(link).toContain("subject=Application%3A%20Operations%20Executive");
    expect(link).toContain("body=Dear%20Hiring%20Team%2C%0A%0APlease");
    expect(link).not.toContain("+");
  });
  it("works without a recipient", () => {
    expect(mailtoLink("", "Hi", "")).toBe("mailto:?subject=Hi");
  });
  it("builds a Gmail compose link", () => {
    const link = gmailComposeLink("jobs@stora.co", "Subject here", "Body\ntext");
    const u = new URL(link);
    expect(u.hostname).toBe("mail.google.com");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("to")).toBe("jobs@stora.co");
    expect(u.searchParams.get("su")).toBe("Subject here");
    expect(u.searchParams.get("body")).toBe("Body\ntext");
  });
});

describe("wordCount", () => {
  it("counts words", () => {
    expect(wordCount("  Why this role   matters\n\n- Support the COO ")).toBe(7);
    expect(wordCount("")).toBe(0);
    expect(wordCount(null)).toBe(0);
  });
});

describe("followUpDays", () => {
  const today = "2026-11-25";
  const a = (status: string, changed: string | null, submitted: string | null = null) => ({
    status,
    status_changed_at: changed,
    date_submitted: submitted,
  });
  it("flags applications waiting 10+ days with no reply", () => {
    expect(followUpDays(a("applied", "2026-11-15T09:00:00Z"), today)).toBe(10);
    expect(followUpDays(a("applied", "2026-11-01T09:00:00Z"), today)).toBe(24);
  });
  it("doesn't flag recent ones, or ones that have moved on", () => {
    expect(followUpDays(a("applied", "2026-11-20T09:00:00Z"), today)).toBeNull();
    expect(followUpDays(a("screening_call", "2026-10-01T09:00:00Z"), today)).toBeNull();
    expect(followUpDays(a("rejected", "2026-10-01T09:00:00Z"), today)).toBeNull();
    expect(followUpDays(a("draft", "2026-10-01T09:00:00Z"), today)).toBeNull();
  });
  it("falls back to the submitted date, and ignores missing dates", () => {
    expect(followUpDays(a("applied", null, "2026-11-05"), today)).toBe(20);
    expect(followUpDays(a("applied", null, null), today)).toBeNull();
  });
});
