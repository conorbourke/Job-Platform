import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/config";
import { withTimeout } from "@/lib/timeout";

/**
 * Private, single-owner app. Every page and API needs a session for the owner
 * account (the user whose app_metadata.pin_owner is true, set by
 * public.set_owner_pin in the database). Sign-in is by PIN only (/login).
 */

// Pages anyone may see.
const PUBLIC_PAGES = new Set(["/login"]);
// APIs that do their own authentication.
const PUBLIC_API_PREFIXES = [
  "/api/auth/pin", // the PIN sign-in itself (lockout enforced in the database)
  "/api/cron/", // scheduled jobs, protected by CRON_SECRET
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  if (isApi && PUBLIC_API_PREFIXES.some((p) => path === p || path.startsWith(p))) {
    return response;
  }
  const isPublicPage = PUBLIC_PAGES.has(path);

  // Turn a request away: APIs get a 401, pages go to the PIN screen.
  const deny = (reason?: string) => {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (reason) url.searchParams.set("error", reason);
    else if (path !== "/") url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  };

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return isPublicPage ? response : deny("not_configured");
  }

  let user: User | null = null;
  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });
    // Refresh the session (required for SSR auth). Time-boxed so a slow or
    // unreachable Supabase can't hang every request.
    ({
      data: { user },
    } = await withTimeout(supabase.auth.getUser(), 5000, "auth.getUser"));
  } catch {
    return isPublicPage ? response : deny("auth_unavailable");
  }

  const isOwner = user?.app_metadata?.pin_owner === true;

  if (isPublicPage) {
    // Already signed in? Skip the PIN screen.
    if (isOwner && path === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Signed in as anyone other than the owner counts as not signed in.
  if (!isOwner) return deny(user ? "not_allowed" : undefined);

  if (path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Everything except Next's static assets and plain files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico|css|js)$).*)"],
};
