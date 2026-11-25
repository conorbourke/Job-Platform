import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { clientIp, isValidPin } from "@/lib/pin";

/**
 * PIN sign-in. POST { pin: "123456" }.
 *
 * 1. public.verify_pin (Postgres, service role only) checks the PIN against its
 *    bcrypt hash and enforces the lockout atomically: 3 wrong PINs lock the
 *    account for 1 hour, during which no PIN — not even the right one — is
 *    accepted.
 * 2. On success the server mints the session itself: it creates a one-time
 *    sign-in token for the owner (admin generateLink — no email is sent) and
 *    redeems it immediately, which sets the session cookies on this response.
 *
 * Responses: 200 ok · 400 bad format · 401 wrong PIN (+attempts_left) ·
 * 429 locked (+locked_until) · 503 not set up.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const pin = (body as { pin?: unknown }).pin;
  // Malformed input is rejected before it reaches the database, so it never
  // counts as an attempt.
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: "Enter your 6-digit PIN." }, { status: 400 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Sign-in isn't configured on the server (SUPABASE_SERVICE_ROLE_KEY is missing)." },
      { status: 503 }
    );
  }
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("verify_pin", {
    p_pin: pin,
    p_ip: clientIp(request.headers),
  });
  if (error) {
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable. Please try again shortly." },
      { status: 503 }
    );
  }

  const result = data as {
    status: "ok" | "invalid" | "locked" | "not_configured";
    email?: string;
    attempts_left?: number;
    locked_until?: string;
  };

  switch (result.status) {
    case "not_configured":
      return NextResponse.json(
        { error: "PIN sign-in hasn't been set up yet. Run the setup SQL in Supabase." },
        { status: 503 }
      );
    case "locked":
      return NextResponse.json(
        { error: "locked", locked_until: result.locked_until },
        { status: 429 }
      );
    case "invalid":
      return NextResponse.json(
        { error: "invalid", attempts_left: result.attempts_left ?? 0 },
        { status: 401 }
      );
    case "ok":
      break;
    default:
      return NextResponse.json({ error: "Unexpected response." }, { status: 500 });
  }

  // Correct PIN: create a one-time token for the owner and redeem it here.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: result.email!,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return NextResponse.json({ error: "Couldn't start a session. Please try again." }, { status: 500 });
  }

  const supabase = await createClient();
  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (otpError) {
    return NextResponse.json({ error: "Couldn't start a session. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
