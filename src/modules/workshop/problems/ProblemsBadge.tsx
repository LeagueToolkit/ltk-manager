import { SeverityGlyph, Tooltip } from "@/components";
import { useShowSidebarView } from "@/stores";

import { useProjectProblems } from "../api";
import { useProjectContext } from "../components/ProjectContext";
import { countBySeverity, isMuted, type SeverityCounts } from "./problemGroups";
import { useMutedRules } from "./runCatalogue";

/**
 * What the whole project has to answer for, beside the actions that pack it.
 *
 * Nothing is drawn while a project is clean, because a control that is always
 * there and always says zero is a control a user stops reading.
 *
 * A finding about a change Riot has not deployed is not something the project
 * has to answer for, so it is left out of this count. The panel still lists it,
 * muted, and a modder preparing a release for that build can count it there.
 */
export function ProblemsBadge() {
  const project = useProjectContext();
  const { data: run } = useProjectProblems(project.path);
  const muted = useMutedRules();
  const showView = useShowSidebarView();

  if (!run) return null;

  const counts = countBySeverity(run.problems.filter((problem) => !isMuted(problem, muted)));
  /* The worst severity present rather than errors alone. A modder counting a
     check early sees only warnings, and that is the person it is for. */
  const worst = severityShown(counts);
  if (!worst) return null;

  return (
    <Tooltip content="Open Problems">
      <button
        type="button"
        onClick={() => showView("problems")}
        aria-label={`${worst.count} ${worst.noun}, open Problems`}
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-surface-200 transition-colors outline-none hover:bg-surface-veil focus-visible:ring-1 focus-visible:ring-accent-500/60"
      >
        <SeverityGlyph severity={worst.severity} />
        <span className="tabular-nums">{worst.count}</span>
      </button>
    </Tooltip>
  );
}

function severityShown(counts: SeverityCounts) {
  if (counts.fatals > 0) {
    return { severity: "fatal" as const, count: counts.fatals, noun: noun(counts.fatals, "crash") };
  }
  if (counts.errors > 0) {
    return { severity: "error" as const, count: counts.errors, noun: noun(counts.errors, "error") };
  }
  if (counts.warnings > 0) {
    return {
      severity: "warning" as const,
      count: counts.warnings,
      noun: noun(counts.warnings, "warning"),
    };
  }
  return null;
}

function noun(count: number, word: string) {
  if (count === 1) return word;
  return `${word}s`;
}
