import { ArrowsClockwiseIcon, WrenchIcon } from "@phosphor-icons/react";
import { twMerge } from "tailwind-merge";

import { IconButton, Tooltip } from "@/components";

import { useFixProblems, useProjectProblems } from "../api";
import { useProjectContext } from "../components/ProjectContext";
import { useShownProblems } from "./runCatalogue";

/** Re-run the checks and repair the whole project. */
export function ProblemsActions() {
  const project = useProjectContext();
  const { isFetching, refetch } = useProjectProblems(project.path);
  const fix = useFixProblems();

  /* What is on screen, so the panel's Fix reaches exactly the rows a reader
     can see. A scope that quietly stopped short of one would leave it broken
     and say it was done. */
  const fixable = useShownProblems().filter((problem) => problem.fix);

  function handleFix() {
    fix.mutate({
      projectPath: project.path,
      problems: fixable.map((problem) => problem.id),
    });
  }

  return (
    <>
      {fixable.length > 0 && (
        <Tooltip content={fixTip(fixable.length)}>
          <IconButton
            icon={<WrenchIcon weight="bold" className="h-4 w-4" />}
            variant="ghost"
            size="xs"
            compact
            loading={fix.isPending}
            onClick={handleFix}
            aria-label={fixTip(fixable.length)}
            className="h-6 w-6"
          />
        </Tooltip>
      )}

      <Tooltip content="Check the project again">
        <IconButton
          icon={
            <ArrowsClockwiseIcon
              weight="bold"
              className={twMerge("h-4 w-4", isFetching && "animate-spin")}
            />
          }
          variant="ghost"
          size="xs"
          compact
          onClick={() => void refetch()}
          aria-label="Check the project again"
          className="h-6 w-6"
        />
      </Tooltip>
    </>
  );
}

/* A fix reaches every layer, because a mod is every layer it ships. */
function fixTip(count: number) {
  if (count === 1) return "Fix 1 problem across the project";
  return `Fix ${count} problems across the project`;
}
