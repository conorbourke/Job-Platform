import { describe, expect, it } from "vitest";
import { matchesSearchLocation } from "./location";

// The default wanted location is Belfast (JOB_SEARCH_LOCATIONS in config).
describe("matchesSearchLocation — Belfast only", () => {
  it("keeps postings that state Belfast, however it's written", () => {
    expect(matchesSearchLocation("Belfast")).toBe(true);
    expect(matchesSearchLocation("belfast")).toBe(true);
    expect(matchesSearchLocation("Belfast, Northern Ireland")).toBe(true);
    expect(matchesSearchLocation("Hybrid – Belfast City Centre")).toBe(true);
    expect(matchesSearchLocation("Belfast BT1 5GS")).toBe(true);
  });

  it("treats a BT postcode as Belfast", () => {
    expect(matchesSearchLocation("BT9 5AB")).toBe(true);
    expect(matchesSearchLocation("Lisburn BT28")).toBe(true);
  });

  it("keeps postings with no stated location (found via a Belfast-targeted search)", () => {
    expect(matchesSearchLocation(null)).toBe(true);
    expect(matchesSearchLocation(undefined)).toBe(true);
    expect(matchesSearchLocation("")).toBe(true);
    expect(matchesSearchLocation("   ")).toBe(true);
  });

  it("drops postings stated to be anywhere else, including remote", () => {
    expect(matchesSearchLocation("Dublin")).toBe(false);
    expect(matchesSearchLocation("London, UK")).toBe(false);
    expect(matchesSearchLocation("Remote")).toBe(false);
    expect(matchesSearchLocation("Worldwide")).toBe(false);
    expect(matchesSearchLocation("Berlin, Germany")).toBe(false);
    // Northern Ireland alone isn't Belfast — it covers Derry etc.
    expect(matchesSearchLocation("Northern Ireland")).toBe(false);
  });

  it("does not mistake 'bt' inside a word for a postcode", () => {
    expect(matchesSearchLocation("Debt collection team, Manchester")).toBe(false);
  });
});

describe("matchesSearchLocation — custom location list", () => {
  it("honours the given places and only applies the BT rule when Belfast is wanted", () => {
    expect(matchesSearchLocation("Dublin 2", ["Dublin"])).toBe(true);
    expect(matchesSearchLocation("Belfast", ["Dublin"])).toBe(false);
    expect(matchesSearchLocation("BT1 5GS", ["Dublin"])).toBe(false);
    expect(matchesSearchLocation("Belfast", ["Dublin", "Belfast"])).toBe(true);
  });
});
