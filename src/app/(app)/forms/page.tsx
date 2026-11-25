import { redirect } from "next/navigation";

/** Application forms are handled inside each job's Apply workspace (Send → Online form). */
export default function FormsPage() {
  redirect("/jobs");
}
