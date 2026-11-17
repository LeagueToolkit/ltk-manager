import { m } from "@/i18n";
import type { AdvisoryCode, AdvisorySubject, InstalledMod, ShownAdvisory } from "@/lib/tauri";

/** The sentence for each advisory code, exhaustive over the codes. A code without a sentence fails `tsc`. */
const ADVISORY_TEXT: Readonly<Record<AdvisoryCode, () => string>> = {
  "mod-missing": () => m["advisory.mod-missing"](),
  "mod-content-missing": () => m["advisory.mod-content-missing"](),
  "layers-unset": () => m["advisory.layers-unset"](),
  "locale-missing": () => m["advisory.locale-missing"](),
  "entry-unreadable": () => m["advisory.entry-unreadable"](),
  "overlay-refused": () => m["advisory.overlay-refused"](),
  "archive-not-served": () => m["advisory.archive-not-served"](),
  "skin-data-stale": () => m["advisory.skin-data-stale"](),
  "dll-unattested": () => m["advisory.dll-unattested"](),
  "patcher-uncoded": () => m["advisory.patcher-uncoded"](),
};

/** The codes of a mod that the build left out of the overlay. */
const NOT_APPLIED: readonly AdvisoryCode[] = [
  "mod-missing",
  "mod-content-missing",
  "entry-unreadable",
];

/** The card that a badge is on: a library mod or a workshop project. */
export interface AdvisoryTarget {
  modId?: string;
  projectPath?: string;
}

/** Returns the sentence of the advisory code `code`. */
export function advisoryText(code: AdvisoryCode): string {
  return ADVISORY_TEXT[code]();
}

/** Returns whether a rebuild of the overlay is the fix of the advisory code `code`. */
export function advisoryOffersRebuild(code: AdvisoryCode): boolean {
  return code === "archive-not-served";
}

/**
 * Returns the label of the status bar cell for `advisories`.
 *
 * The label counts the mods that the build left out. If the build left out no mod, the label
 * counts the advisories.
 */
export function advisoriesLabel(advisories: readonly ShownAdvisory[]): string {
  const notApplied = advisories.filter((advisory) => NOT_APPLIED.includes(advisory.code)).length;
  if (notApplied > 0) return m.diagnostics_advisories_not_applied_label({ count: notApplied });

  return m.diagnostics_advisories_count_label({ count: advisories.length });
}

/** Returns the advisories of `advisories` that are about `target`. */
export function advisoriesAbout(
  advisories: readonly ShownAdvisory[],
  { modId, projectPath }: AdvisoryTarget,
): ShownAdvisory[] {
  return advisories.filter(({ subject }) => {
    if (subject?.kind === "mod") return subject.id === modId;
    if (subject?.kind === "project") return subject.path === projectPath;
    return false;
  });
}

/**
 * Returns the name that the app shows for `subject`.
 *
 * A mod is named by its display name in `mods`, and by its id if `mods` does not hold it. A
 * project is named by the last segment of its path.
 */
export function subjectName(
  subject: AdvisorySubject,
  mods: readonly Pick<InstalledMod, "id" | "displayName">[],
): string {
  switch (subject.kind) {
    case "mod":
      return mods.find((mod) => mod.id === subject.id)?.displayName ?? subject.id;
    case "archive":
      return subject.name;
    case "project":
      return subject.path.split(/[\\/]/).filter(Boolean).at(-1) ?? subject.path;
  }
}
