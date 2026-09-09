import { CaretRightIcon, WrenchIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Code, IconButton, SeverityGlyph, SeverityTally, Tooltip } from "@/components";
import { useZoomedPx } from "@/hooks";
import type { FixPreview, Problem } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { useFixProblems } from "../api";
import { useProjectContext } from "../components/ProjectContext";
import { previewDocument } from "../documents";
import { useOpenDocumentTab } from "../state";
import {
  problemAddress,
  type ProblemGroup,
  type ProblemObject,
  splitWadPath,
} from "./problemGroups";
import { useMutedProblem, useObjectName, useRuleInfo } from "./runCatalogue";

/** A header is one line and a problem is two, which is what sizes the virtualizer. */
export const GROUP_ROW_HEIGHT = 28;
export const OBJECT_ROW_HEIGHT = 28;
export const PROBLEM_ROW_HEIGHT = 46;

/** How long a row waits before it explains itself, in ms. */
const TIP_DELAY = 500;

interface GroupRowProps {
  group: ProblemGroup;
  expanded: boolean;
  onToggle: (id: string) => void;
}

/** One file, with the count of what it holds and a Fix for all of it. */
export function ProblemGroupRow({ group, expanded, onToggle }: GroupRowProps) {
  const project = useProjectContext();
  const fix = useFixProblems();
  const zoomed = useZoomedPx();

  const fixable = group.problems.filter((problem) => problem.fix);

  function handleFix() {
    fix.mutate({
      projectPath: project.path,
      problems: fixable.map((problem) => problem.id),
      label: group.fileName,
    });
  }

  /* The archive is the same on nearly every row of a project, so it goes to the
     tooltip and the path inside it gets the width. */
  const { inner } = splitWadPath(group.path);

  return (
    <div
      className="group/row flex items-center gap-2 bg-surface-900/40 pr-2 pl-2 text-row transition-colors duration-100 hover:bg-surface-800/60"
      style={{ height: zoomed(GROUP_ROW_HEIGHT) }}
    >
      <Tooltip content={`${group.layer} · ${group.path}`} side="top" delay={TIP_DELAY}>
        <button
          type="button"
          onClick={() => onToggle(group.id)}
          aria-expanded={expanded}
          aria-label={`${group.layer} · ${group.path}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-accent-500/60"
        >
          <CaretRightIcon
            weight="bold"
            className={twMerge("h-3 w-3 shrink-0 text-surface-400", expanded && "rotate-90")}
          />
          <SeverityTally counts={group} />
          <span className="shrink-0 text-meta text-surface-400">{group.layer}</span>
          <span className="truncate font-mono text-code text-surface-100">{inner}</span>
        </button>
      </Tooltip>

      {fixable.length > 0 && (
        <Tooltip content={`Fix every problem in ${group.fileName}`}>
          <IconButton
            icon={<WrenchIcon weight="bold" className="h-3.5 w-3.5" />}
            variant="ghost"
            size="xs"
            compact
            loading={fix.isPending}
            onClick={handleFix}
            aria-label={`Fix every problem in ${group.fileName}`}
            className="h-5 w-5 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          />
        </Tooltip>
      )}
    </div>
  );
}

interface ObjectRowProps {
  object: ProblemObject;
  expanded: boolean;
  onToggle: (id: string) => void;
}

/**
 * One object of a file, with the count of what it holds and a Fix for all of it.
 *
 * A bin holds a handful of objects and a file's findings scatter over them, so
 * the object is the level at which "what is broken" reads as one answer. Its
 * path is drawn where a table names it and its hash where none does.
 */
export function ProblemObjectRow({ object, expanded, onToggle }: ObjectRowProps) {
  const project = useProjectContext();
  const fix = useFixProblems();
  const zoomed = useZoomedPx();

  const fixable = object.problems.filter((problem) => problem.fix);

  function handleFix() {
    fix.mutate({
      projectPath: project.path,
      problems: fixable.map((problem) => problem.id),
      label: object.name,
    });
  }

  return (
    <div
      /* DS-VEIL */
      className="group/row flex items-center gap-2 pr-2 pl-4 text-row transition-colors duration-100 hover:bg-surface-veil"
      style={{ height: zoomed(OBJECT_ROW_HEIGHT) }}
    >
      <Tooltip content={object.name} side="top" delay={TIP_DELAY}>
        <button
          type="button"
          onClick={() => onToggle(object.id)}
          aria-expanded={expanded}
          aria-label={object.name}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-accent-500/60"
        >
          <CaretRightIcon
            weight="bold"
            className={twMerge("h-3 w-3 shrink-0 text-surface-500", expanded && "rotate-90")}
          />
          <span className="truncate font-mono text-code text-surface-200">{object.name}</span>
        </button>
      </Tooltip>

      {fixable.length > 0 && (
        <Tooltip content={`Fix every problem in ${object.name}`}>
          <IconButton
            icon={<WrenchIcon weight="bold" className="h-3.5 w-3.5" />}
            variant="ghost"
            size="xs"
            compact
            loading={fix.isPending}
            onClick={handleFix}
            aria-label={`Fix every problem in ${object.name}`}
            className="h-5 w-5 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          />
        </Tooltip>
      )}
    </div>
  );
}

/** One finding: where it is, what it becomes, and the repair for it. */
export function ProblemRow({ problem }: { problem: Problem }) {
  const project = useProjectContext();
  const openTab = useOpenDocumentTab();
  const fix = useFixProblems();
  const zoomed = useZoomedPx();
  const muted = useMutedProblem(problem);

  function open() {
    openTab(
      previewDocument({
        kind: "layer",
        project: project.path,
        layer: problem.site.layer,
        path: problem.site.path,
      }),
    );
  }

  function handleFix() {
    fix.mutate({
      projectPath: project.path,
      problems: [problem.id],
      label: problemAddress(problem),
    });
  }

  return (
    <div
      /* DS-VEIL. A finding the installed game has not reached yet is dimmed
         rather than restyled, so its severity glyph keeps meaning what it
         means. Pointing at it brings it back to full. */
      className={twMerge(
        "group/row flex items-center gap-2 pr-2 pl-6 text-row transition-[color,background-color,opacity] duration-100 hover:bg-surface-veil",
        muted && "opacity-55 hover:opacity-100",
      )}
      style={{ height: zoomed(PROBLEM_ROW_HEIGHT) }}
    >
      <Tooltip content={<ProblemTip problem={problem} />} side="top" delay={TIP_DELAY}>
        <button
          type="button"
          onClick={open}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-sm py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent-500/60"
        >
          <span className="mt-0.5 shrink-0">
            <SeverityGlyph severity={problem.severity} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <ProblemTitle problem={problem} />
              <MismatchLabel problem={problem} />
            </span>
            <ProblemAddress problem={problem} />
          </span>
        </button>
      </Tooltip>

      {problem.fix && (
        <Tooltip content="Apply this repair" side="left">
          <IconButton
            icon={<WrenchIcon weight="bold" className="h-3.5 w-3.5" />}
            variant="ghost"
            size="xs"
            compact
            loading={fix.isPending}
            onClick={handleFix}
            aria-label="Fix this problem"
            className="h-6 w-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          />
        </Tooltip>
      )}
    </div>
  );
}

/** What kind of problem this is, which is what the check calls itself. */
function ProblemTitle({ problem }: { problem: Problem }) {
  const rule = useRuleInfo(problem.rule);

  return (
    <span className="truncate font-medium text-surface-100">{rule?.title ?? problem.rule}</span>
  );
}

/** The types, in the sentence a compiler would write. */
function MismatchLabel({ problem }: { problem: Problem }) {
  if (!problem.mismatch) return null;

  return (
    <span className="shrink-0 text-surface-400">
      Expected <Code>{problem.mismatch.expected}</Code>, found <Code>{problem.mismatch.found}</Code>
    </span>
  );
}

/** Where inside the file the problem is, kept whole and kept readable. */
function ProblemAddress({ problem }: { problem: Problem }) {
  const address = problemAddress(problem);
  const cut = address.lastIndexOf(".");

  if (cut === -1) {
    return <span className="truncate font-mono text-code text-surface-300">{address}</span>;
  }

  return (
    <span className="flex min-w-0 items-baseline font-mono text-code text-surface-300">
      <span className="truncate">{address.slice(0, cut + 1)}</span>
      <span className="shrink-0">{address.slice(cut + 1)}</span>
    </span>
  );
}

function ProblemTip({ problem }: { problem: Problem }) {
  const rule = useRuleInfo(problem.rule);
  const entry = problem.site.node?.entry;
  const object = useObjectName(entry);

  return (
    <div className="flex max-w-md flex-col gap-2 py-1 text-meta">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-row">
          <SeverityGlyph severity={problem.severity} />
          <span className="font-medium text-surface-50">{rule?.title ?? problem.rule}</span>
        </span>
        {/* The finding's own sentence where it has one, the rule's where it
            does not. One slot, because a rule that describes itself and a row
            that describes itself say the same thing twice. */}
        <span className="text-surface-400">{problem.message ?? rule?.description}</span>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-surface-700 pt-2">
        <TipLabel>Layer</TipLabel>
        <dd className="text-surface-200">{problem.site.layer}</dd>

        <TipLabel>File</TipLabel>
        <TipValue>{problem.site.path}</TipValue>

        {entry && (
          <>
            <TipLabel>Object</TipLabel>
            <TipValue>{object ?? entry}</TipValue>
          </>
        )}

        {problem.fix && <TipValueRow fix={problem.fix} />}
      </dl>

      <span className="text-surface-500">{problem.rule}</span>
    </div>
  );
}

function TipLabel({ children }: { children: ReactNode }) {
  return <dt className="text-surface-500">{children}</dt>;
}

/* DS-CODE-CHIP */
function TipValue({ children }: { children: ReactNode }) {
  return (
    <dd className="min-w-0">
      <Code>{children}</Code>
    </dd>
  );
}

/* What the file holds at this property, which is the half a reader is checking.
   A container draws one of its paths and how many more it holds. */
function TipValueRow({ fix }: { fix: FixPreview }) {
  if (fix.before) {
    return (
      <>
        <TipLabel>Value</TipLabel>
        <dd className="flex min-w-0 flex-col items-start gap-1">
          {/* DS-CODE-CHIP */}
          <Code>{fix.before}</Code>
          {fix.note && <span className="text-surface-400">{fix.note}</span>}
        </dd>
      </>
    );
  }

  if (fix.note) {
    return (
      <>
        <TipLabel>Value</TipLabel>
        <dd className="text-surface-200">{fix.note}</dd>
      </>
    );
  }

  return null;
}
