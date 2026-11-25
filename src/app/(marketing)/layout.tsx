import Link from "next/link";
import { APP_NAME } from "@/config";

/** Layout for the public pages (Privacy, Terms). */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/login" className="btn-primary">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-neutral-500">
          <p>
            © {new Date().getFullYear()} {APP_NAME}
          </p>
          <nav className="flex gap-6">
            <Link href="/privacy" className="hover:text-neutral-900">Privacy</Link>
            <Link href="/terms" className="hover:text-neutral-900">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
