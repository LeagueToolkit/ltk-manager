import type {
  AdvisoryCode,
  Incident,
  InstalledMod,
  KnownIssue,
  PendingUpdate,
  ShownAdvisory,
} from "@/lib/tauri";
import { advisoryOffersRebuild, offersRebuild, subjectName } from "@/modules/diagnostics";

/**
 * One row of the `Findings` section.
 *
 * An update, a known issue, a mod and a row with a rebuild are known causes: the manager knows
 * a fix, so the dialog offers the fix before the send actions.
 */
export type Finding =
  | { kind: "update"; installed: string; latest: string }
  | { kind: "issue"; issue: KnownIssue }
  | { kind: "verdict"; incident: Incident; rebuild: boolean }
  | { kind: "mod"; name: string; pageUrl: string | null }
  | {
      kind: "advisory";
      code: AdvisoryCode;
      /** The names of the mods, archives and projects that the advisories of the code are about. */
      subjects: string[];
      /** The code that the patcher gave the condition. */
      patcherCode: string | null;
      rebuild: boolean;
    };

export interface FindingInputs {
  /** The release that the updater offers. */
  update: Pick<PendingUpdate, "version" | "currentVersion"> | null;
  /** The known issues that the maintainers publish for this build. */
  issues: readonly KnownIssue[];
  /** The incident that the report is about. */
  incident: Incident | null;
  /** The advisories of the last build and of the newest game, muted ones included. */
  advisories: readonly ShownAdvisory[];
  mods: readonly InstalledMod[];
}

/**
 * Returns the known issue that explains the verdict of `incident` or one of `advisories`.
 *
 * Returns the first issue of `issues` that lists the verdict kind or the code of an advisory.
 * Returns `null` if no issue lists either.
 */
export function knownIssueFor(
  issues: readonly KnownIssue[],
  incident: Incident | null,
  advisories: readonly ShownAdvisory[],
): KnownIssue | null {
  const verdict = incident?.verdict.kind;

  return (
    issues.find(
      (issue) =>
        (verdict !== undefined && issue.verdicts.includes(verdict)) ||
        advisories.some((advisory) => issue.advisories.includes(advisory.code)),
    ) ?? null
  );
}

/**
 * Returns what the manager found, in the order that the dialog shows it.
 *
 * The order is the update, the known issue, the verdict, the mod and the advisories. An update
 * can hold the fix for everything after it. A known issue is the maintainers' answer to the
 * verdict or to an advisory. The mod follows the verdict, because the verdict states why the
 * mod is named.
 *
 * The mod row is present if the incident names exactly one suspect and that suspect is a
 * library mod. A workshop project is the user's own work, so it gets no row.
 *
 * Each advisory code has one row, in the order of `advisories`. The row offers a rebuild if
 * a rebuild is the fix of the code and the verdict does not offer one.
 */
export function findings({ update, issues, incident, advisories, mods }: FindingInputs): Finding[] {
  const found: Finding[] = [];

  if (update) {
    found.push({ kind: "update", installed: update.currentVersion, latest: update.version });
  }

  const issue = knownIssueFor(issues, incident, advisories);
  if (issue) found.push({ kind: "issue", issue });

  const verdictRebuilds = incident !== null && offersRebuild(incident.verdict);
  if (incident) {
    found.push({ kind: "verdict", incident, rebuild: verdictRebuilds });

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

  const rows = new Map<AdvisoryCode, Extract<Finding, { kind: "advisory" }>>();
  for (const { code, subject, patcherCode } of advisories) {
    const row = rows.get(code) ?? {
      kind: "advisory",
      code,
      subjects: [],
      patcherCode,
      rebuild: advisoryOffersRebuild(code) && !verdictRebuilds,
    };
    if (subject) row.subjects.push(subjectName(subject, mods));
    rows.set(code, row);
  }
  found.push(...rows.values());

  return found;
}

/** Returns whether `finding` is a known cause, which moves the send actions into a menu. */
export function isKnownCause(finding: Finding): boolean {
  if (finding.kind === "verdict" || finding.kind === "advisory") return finding.rebuild;

  return true;
}
