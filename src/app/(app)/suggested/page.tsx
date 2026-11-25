import { redirect } from "next/navigation";

/** New Jobs is now the Jobs page. */
export default function SuggestedPage() {
  redirect("/jobs");
}
