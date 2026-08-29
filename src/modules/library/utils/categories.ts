import type { InstalledMod, ModWadReport } from "@/lib/tauri";

/**
 * A mod's filterable categories: declared metadata unioned with values derived
 * from its WAD footprint. The `derived*` lists hold only the derived values that
 * are NOT already declared — they drive the "auto" pills and edit suggestions.
 */
export interface EffectiveCategories {
  tags: string[];
  champions: string[];
  maps: string[];
  derivedTags: string[];
  derivedChampions: string[];
  derivedMaps: string[];
  /**
   * The derived champion the mod puts the most content into, of
   * [`derivedChampions`].
   *
   * For a surface with room for one champion rather than every champion a mod
   * touches. `null` when the analysis predates the weighting, or when a
   * declared champion has already claimed the one the report named.
   */
  primaryDerivedChampion: string | null;
}

/**
 * Normalization key for de-duplicating a derived value against a declared one:
 * lowercase, alphanumerics only. Mirrors the backend so a derived `"Aatrox"`
 * collapses against a user-typed `"aatrox"`.
 */
export function normKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Union declared values with derived ones. Declared values win — their casing
 * is preserved and they never appear in `derivedOnly`. Derived values absent
 * from the declared set (by normalized key) are appended and collected into
 * `derivedOnly`.
 */
function mergeCategory(
  declared: string[],
  derived: readonly string[] | undefined,
): { merged: string[]; derivedOnly: string[] } {
  const seen = new Set(declared.map(normKey));
  const merged = [...declared];
  const derivedOnly: string[] = [];

  for (const raw of derived ?? []) {
    const value = raw.trim();
    const key = normKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
    derivedOnly.push(value);
  }

  return { merged, derivedOnly };
}

/**
 * Compute a mod's effective categories from its declared metadata and its
 * (possibly missing) WAD-footprint report.
 */
export function computeEffectiveCategories(
  mod: InstalledMod,
  report: ModWadReport | null | undefined,
): EffectiveCategories {
  const tags = mergeCategory(mod.tags, report?.derived.tags);
  const champions = mergeCategory(mod.champions, report?.derived.champions);
  const maps = mergeCategory(mod.maps, report?.derived.maps);

  // A declared champion outranks a derived one, so the primary is only the
  // primary while it is still one of the pills the report contributed.
  const primary = report?.derived.primaryChampion ?? null;
  const primaryDerivedChampion = champions.derivedOnly.includes(primary ?? "") ? primary : null;

  return {
    tags: tags.merged,
    champions: champions.merged,
    maps: maps.merged,
    derivedTags: tags.derivedOnly,
    derivedChampions: champions.derivedOnly,
    derivedMaps: maps.derivedOnly,
    primaryDerivedChampion,
  };
}
