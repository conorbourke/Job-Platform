import { redirect } from "next/navigation";

/** Recommended is now a tab on the Jobs page. */
export default function RecommendedPage() {
  redirect("/jobs?tab=recommended");
}
