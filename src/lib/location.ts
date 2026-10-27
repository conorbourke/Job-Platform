import { JOB_SEARCH_LOCATIONS } from "../config";

/**
 * Is a posting's stated location within the wanted locations (default:
 * JOB_SEARCH_LOCATIONS from config)?
 *
 * - No stated location → allowed through. Such postings came back from a
 *   location-targeted search, so dropping them would lose real local results.
 * - Otherwise the location text must mention one of the wanted places.
 * - When Belfast is wanted, a BT postcode (BT1–BT99) counts as Belfast too,
 *   since many adverts give only the postcode.
 *
 * Kept free of other imports so it's trivially unit-testable.
 */
export function matchesSearchLocation(
  location: string | null | undefined,
  locations: readonly string[] = JOB_SEARCH_LOCATIONS
): boolean {
  if (!location || !location.trim()) return true;
  const l = location.toLowerCase();
  if (locations.some((p) => l.includes(p.toLowerCase()))) return true;
  const wantsBelfast = locations.some((p) => p.toLowerCase() === "belfast");
  if (wantsBelfast && /\bbt\d{1,2}\b/i.test(location)) return true;
  return false;
}
