import { describe, expect, it } from "vitest";
import { canonicalJobUrl, linkedinJobId } from "./scrape";

describe("linkedinJobId", () => {
  it("reads the id from the link you pasted (tracking params and all)", () => {
    expect(
      linkedinJobId(
        "https://www.linkedin.com/jobs/view/4477199196/?alternateChannel=search&trackingId=vzBxP8Sg%2FpKcBB8HXqyyGw%3D%3D"
      )
    ).toBe("4477199196");
  });
  it("handles the other LinkedIn job-link shapes", () => {
    expect(linkedinJobId("https://www.linkedin.com/jobs/view/4477199196")).toBe("4477199196");
    expect(linkedinJobId("https://uk.linkedin.com/jobs/view/operations-executive-at-stora-4477199196")).toBe("4477199196");
    expect(linkedinJobId("https://www.linkedin.com/jobs/search/?currentJobId=4477199196&keywords=ops")).toBe("4477199196");
    expect(linkedinJobId("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4477199196")).toBe("4477199196");
    expect(linkedinJobId("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4477199196")).toBe("4477199196");
  });
  it("ignores non-job LinkedIn links and other sites", () => {
    expect(linkedinJobId("https://www.linkedin.com/in/someone")).toBeNull();
    expect(linkedinJobId("https://www.linkedin.com/jobs/search/?keywords=ops")).toBeNull();
    expect(linkedinJobId("https://www.irishjobs.ie/job/4477199196")).toBeNull();
    expect(linkedinJobId("https://notlinkedin.com/jobs/view/4477199196")).toBeNull();
    expect(linkedinJobId("not a url")).toBeNull();
  });
});

describe("canonicalJobUrl", () => {
  it("strips LinkedIn tracking so the same job always has the same link", () => {
    const a = canonicalJobUrl(
      "https://www.linkedin.com/jobs/view/4477199196/?alternateChannel=search&trackingId=abc"
    );
    const b = canonicalJobUrl("https://uk.linkedin.com/jobs/view/operations-executive-at-stora-4477199196");
    expect(a).toBe("https://www.linkedin.com/jobs/view/4477199196/");
    expect(b).toBe(a);
  });
  it("leaves other sites' links untouched", () => {
    const u = "https://www.irishjobs.ie/job/ops-manager/123?src=email";
    expect(canonicalJobUrl(u)).toBe(u);
  });
});
