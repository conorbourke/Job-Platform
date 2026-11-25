"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PIN_LENGTH, isValidPin, lockoutMinutesLeft, safeNextPath } from "@/lib/pin";

const PARAM_ERRORS: Record<string, string> = {
  not_allowed: "That account isn't allowed to sign in here.",
  auth_unavailable: "Sign-in is temporarily unavailable. Please try again shortly.",
  not_configured: "Sign-in isn't configured yet.",
};

function PinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(
    PARAM_ERRORS[params.get("error") ?? ""] ?? null
  );
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, tick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const minutesLeft = lockedUntil ? lockoutMinutesLeft(lockedUntil) : 0;
  const locked = minutesLeft > 0;

  // Keep the lockout countdown fresh, and unlock the form when it ends.
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  useEffect(() => {
    if (!locked && !loading) inputRef.current?.focus();
  }, [locked, loading]);

  async function submit(value: string) {
    if (!isValidPin(value) || loading || locked) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        router.replace(safeNextPath(params.get("next")));
        router.refresh();
        return;
      }
      setPin("");
      if (res.status === 429 && json.locked_until) {
        setLockedUntil(json.locked_until);
        setError(null);
      } else if (res.status === 401) {
        const left = Number(json.attempts_left ?? 0);
        setError(
          `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left before a 1-hour lockout.`
        );
      } else {
        setError(json.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setPin("");
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function onChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    if (digits.length === PIN_LENGTH) submit(digits); // auto-submit on the 6th digit
  }

  if (locked) {
    const until = new Date(lockedUntil!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-lg font-semibold">Locked</h1>
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          Too many incorrect PINs. Sign-in is locked until {until} (about {minutesLeft}{" "}
          minute{minutesLeft === 1 ? "" : "s"}).
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(pin);
      }}
      className="space-y-4"
    >
      <h1 className="text-center text-lg font-semibold">Enter your PIN</h1>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <input
        ref={inputRef}
        aria-label="6-digit PIN"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        pattern="[0-9]{6}"
        maxLength={PIN_LENGTH}
        className="input text-center font-mono text-2xl tracking-[0.6em]"
        value={pin}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••"
        autoFocus
      />
      <button
        type="submit"
        disabled={loading || pin.length !== PIN_LENGTH}
        className="btn-primary w-full"
      >
        {loading ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <PinForm />
    </Suspense>
  );
}
