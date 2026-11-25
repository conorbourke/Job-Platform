"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { APP_NAME } from "@/config";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { href: "/dashboard", label: "Today" },
  { href: "/jobs", label: "Jobs" },
  { href: "/tracker", label: "Applied" },
  { href: "/templates", label: "CV & Templates" },
  { href: "/settings", label: "Settings" },
];

/**
 * Navigation. A fixed sidebar on tablets and up; on phones, a slim top bar
 * whose ☰ button slides the same menu in from the left.
 */
export function Sidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Close the phone menu whenever the page changes.
  useEffect(() => setOpen(false), [pathname]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function NavLink({ href, label }: { href: string; label: string }) {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        href={href}
        className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "bg-white/15 text-white"
            : "text-blue-100/80 hover:bg-white/10 hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  }

  return (
    <>
      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-blue-900 px-4 py-3 text-white md:hidden">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg px-2 py-1 text-xl leading-none hover:bg-white/10"
          aria-label="Open menu"
          aria-expanded={open}
        >
          ☰
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-blue-950 bg-blue-900 text-blue-100 transition-transform md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-white">
            {APP_NAME}
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="text-xl leading-none text-blue-200 hover:text-white md:hidden"
            aria-label="Close menu"
          >
            ×
          </button>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {TABS.map((t) => (
            <NavLink key={t.href} {...t} />
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-xs text-blue-200" title={userName}>
            {userName}
          </p>
          <button onClick={signOut} className="mt-1 text-xs text-blue-300 hover:text-white">
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
