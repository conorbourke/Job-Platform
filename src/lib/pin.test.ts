import { describe, expect, it } from "vitest";
import { clientIp, isValidPin, lockoutMinutesLeft, safeNextPath } from "./pin";

describe("isValidPin", () => {
  it("accepts exactly six digits", () => {
    expect(isValidPin("483920")).toBe(true);
    expect(isValidPin("000000")).toBe(true);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "12345", "1234567", "12345a", " 123456", "123456 ", "12 456", "١٢٣٤٥٦"]) {
      expect(isValidPin(bad)).toBe(false);
    }
    expect(isValidPin(123456)).toBe(false);
    expect(isValidPin(null)).toBe(false);
    expect(isValidPin(undefined)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/tracker")).toBe("/tracker");
    expect(safeNextPath("/tracker?x=1")).toBe("/tracker?x=1");
  });
  it("defaults to the dashboard", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath("/login")).toBe("/dashboard");
  });
  it("blocks open redirects to other sites", () => {
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });
});

describe("lockoutMinutesLeft", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  it("rounds up to whole minutes", () => {
    expect(lockoutMinutesLeft("2026-11-25T13:00:00Z", now)).toBe(60);
    expect(lockoutMinutesLeft("2026-11-25T12:30:01Z", now)).toBe(31);
  });
  it("shows at least 1 minute while still locked", () => {
    expect(lockoutMinutesLeft("2026-11-25T12:00:05Z", now)).toBe(1);
  });
  it("is 0 once the lock has passed or for junk", () => {
    expect(lockoutMinutesLeft("2026-11-25T11:59:00Z", now)).toBe(0);
    expect(lockoutMinutesLeft("not a date", now)).toBe(0);
  });
});

describe("clientIp", () => {
  it("prefers Cloudflare's header, then the first forwarded hop", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBeNull();
  });
});
