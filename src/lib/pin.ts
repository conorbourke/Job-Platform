/**
 * PIN login helpers. The real checks — PIN hash, attempt counting and the
 * 3-strikes / 1-hour lockout — happen atomically in Postgres
 * (public.verify_pin, migration 0009). These are the pure bits the route and
 * the login page share.
 */

export const PIN_LENGTH = 6;

/** Exactly six digits. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{6}$/.test(pin);
}

/**
 * Where to go after signing in. Only same-site relative paths are allowed, so
 * a crafted ?next= link can't bounce you to another website (open redirect).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }
  if (next === "/login") return "/dashboard";
  return next;
}

/** Whole minutes until the lockout ends (at least 1 while still locked). */
export function lockoutMinutesLeft(lockedUntil: string | Date, now: Date = new Date()): number {
  const ms = new Date(lockedUntil).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 60000));
}

/** The client IP as Cloudflare / proxies report it (for the audit log only). */
export function clientIp(headers: Headers): string | null {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null
  );
}
