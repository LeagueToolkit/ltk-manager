import type { Incident, InstalledMod, KnownIssue, PendingUpdate } from "@/lib/tauri";
import { offersRebuild } from "@/modules/diagnostics";

/**
 * One row of the `Findings` section.
 *
 * Every kind but a verdict without a rebuild is a known cause: the manager knows a fix, so
 * the dialog offers the fix before the send actions.
 */
export type Finding =
  | { kind: "update"; installed: string; latest: string }
  | { kind: "issue"; issue: KnownIssue }
  | { kind: "verdict"; incident: Incident; rebuild: boolean }
  | { kind: "mod"; name: string; pageUrl: string | null };

export interface FindingInputs {
  /** The release that the updater offers. */
  update: Pick<PendingUpdate, "version" | "currentVersion"> | null;
  /** The known issues that the maintainers publish for this build. */
  issues: readonly KnownIssue[];
  /** The incident that the report is about. */
  incident: Incident | null;
  mods: readonly InstalledMod[];
}

/**
 * Returns the known issue that explains the verdict of `incident`.
 *
 * Returns the first issue of `issues` that lists the verdict kind. Returns `null` if no issue
 * lists it, or if `incident` is `null`.
 */
export function knownIssueFor(
  issues: readonly KnownIssue[],
  incident: Incident | null,
): KnownIssue | null {
  if (!incident) return null;

  return issues.find((issue) => issue.verdicts.includes(incident.verdict.kind)) ?? null;
}

/**
 * Returns what the manager found, in the order that the dialog shows it.
 *
 * The order is the update, the known issue, the verdict and the mod. An update can hold the
 * fix for everything after it. A known issue is the maintainers' answer to the verdict. The
 * mod is the last row, because the verdict states why the mod is named.
 *
 * The mod row is present if the incident names exactly one suspect and that suspect is a
 * library mod. A workshop project is the user's own work, so it gets no row.
 */
export function findings({ update, issues, incident, mods }: FindingInputs): Finding[] {
  const found: Finding[] = [];

  if (update) {
    found.push({ kind: "update", installed: update.currentVersion, latest: update.version });
  }

  const issue = knownIssueFor(issues, incident);
  if (issue) found.push({ kind: "issue", issue });

  if (incident) {
    found.push({ kind: "verdict", incident, rebuild: offersRebuild(incident.verdict) });

    const [suspect, ...others] = incident.suspects;
    if (suspect?.modId && others.length === 0) {
      const mod = mods.find((installed) => installed.id === suspect.modId);
      found.push({
        kind: "mod",
        name: suspect.displayName,
        pageUrl: mod?.origin?.pageUrl ?? null,
      });
    }
  }

  return found;
}

/** Returns whether `finding` is a known cause, which moves the send actions into a menu. */
export function isKnownCause(finding: Finding): boolean {
  return finding.kind !== "verdict" || finding.rebuild;
}
