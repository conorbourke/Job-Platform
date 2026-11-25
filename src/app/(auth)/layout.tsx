import { APP_NAME } from "@/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <p className="mb-8 text-xl font-semibold tracking-tight">{APP_NAME}</p>
      <div className="card w-full max-w-sm p-8">{children}</div>
    </div>
  );
}
