import { CheckCircleIcon } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AlertBox, Code, EmptyState, Spinner } from "@/components";
import { useZoomedPx } from "@/hooks";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";
import { errorSummary } from "@/i18n";

import { useProjectProblems } from "../../api";
import { useProjectContext } from "../../projects/state/ProjectContext";
import { isCollapseAllKey } from "../../shared/utils/treeGestures";
/* The row model is aliased because `ProblemRow` is also the component that
   draws one, which this file imports from `./ProblemRows`. */
import {
  filterProblems,
  flattenGroups,
  groupProblems,
  type ProblemRow as RowModel,
} from "../utils/problemGroups";
import { useObjectNames, useShownProblems } from "../utils/runCatalogue";
import {
  GROUP_ROW_HEIGHT,
  OBJECT_ROW_HEIGHT,
  PROBLEM_ROW_HEIGHT,
  ProblemGroupRow,
  ProblemObjectRow,
  ProblemRow,
} from "./ProblemRows";

/**
 * How many problems a project can hold before its groups start out shut.
 *
 * A skin mod finds a handful and wants to read them without opening anything. A
 * map overhaul finds thousands, where the file list is the useful view.
 */
const AUTO_EXPAND_LIMIT = 20;

interface ProblemsListProps {
  /** What the document's filter box holds, which the toolbar owns. */
  query: string;
  /** A count the toolbar's collapse-all button raises, which collapses every group. */
  collapseAllSignal?: number;
}

/** Every check the manager ran over this project, grouped by the file it read. */
export function ProblemsList({ query, collapseAllSignal = 0 }: ProblemsListProps) {
  const project = useProjectContext();
  const { data: run, isPending, error } = useProjectProblems(project.path);

  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [touched, setTouched] = useState(false);

  const names = useObjectNames();
  const problems = useShownProblems();
  const matches = useMemo(() => filterProblems(problems, query, names), [problems, query, names]);
  const groups = useMemo(() => groupProblems(matches, names), [matches, names]);

  const searching = query.trim().length > 0;
  /* A filtered list that draws only shut group headers reads as a broken
     search, so a query opens what it matched and the carets rest until it is
     cleared.

     Objects open whatever the size, because the level is there to say which
     object a finding is in rather than to hide it, and a file that opened onto
     a list of shut objects would cost a second click to read anything. */
  const expanded = useMemo(() => {
    if (touched && !searching) return opened;

    const files = searching || problems.length <= AUTO_EXPAND_LIMIT;
    const open = new Set<string>();
    for (const group of groups) {
      if (files) open.add(group.id);
      for (const object of group.objects) open.add(object.id);
    }
    return open;
  }, [searching, touched, problems.length, groups, opened]);

  const rows = useMemo(() => flattenGroups(groups, expanded), [groups, expanded]);

  const toggle = useCallback(
    (id: string) => {
      if (searching) return;
      setOpened((current) => {
        /* The first caret click has to inherit what is on screen, which is what
           `expanded` holds and `opened` does not: it is empty both on a list
           that auto-opened and on one that started shut, so seeding from the
           groups would open every file a user never clicked. */
        const next = new Set(touched ? current : expanded);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      setTouched(true);
    },
    [searching, touched, expanded],
  );

  /* Marked touched, so the auto-open rule does not open the list again. */
  const collapseAll = useCallback(() => {
    if (searching) return;

    setOpened(new Set());
    setTouched(true);
  }, [searching]);

  const collapsedFor = useRef(collapseAllSignal);
  useEffect(() => {
    if (collapseAllSignal === collapsedFor.current) return;
    collapsedFor.current = collapseAllSignal;
    collapseAll();
  }, [collapseAllSignal, collapseAll]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isCollapseAllKey(event)) return;

    event.preventDefault();
    collapseAll();
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomed = useZoomedPx();
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => zoomed(rowHeight(rows[index]?.kind)),
    overscan: 12,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  /* Sizes cached at the old zoom outlive a change to it: `estimateSize` is not
     one of the inputs the measurement memo watches. */
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  if (isPending) {
    return (
      <div data-ui="ProblemsList" className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div data-ui="ProblemsList" className="p-2">
        <AlertBox variant="error" title="Couldn't check this project">
          {errorSummary(error)}
        </AlertBox>
      </div>
    );
  }

  return (
    <div data-ui="ProblemsList" className="flex h-full flex-col select-none">
      {run && run.failed.length > 0 && (
        <div className="shrink-0 pb-2">
          <AlertBox variant="warning" title={unreadableTitle(run.failed.length)}>
            {/* DS-CODE-CHIP */}
            <span className="flex flex-wrap gap-1">
              {run.failed.map((failure) => (
                <Code key={`${failure.rule}:${failure.site?.path ?? ""}`}>
                  {failure.site?.path ?? failure.rule}
                </Code>
              ))}
            </span>
          </AlertBox>
        </div>
      )}

      <ProblemsBody empty={problems.length === 0} filteredOut={matches.length === 0} query={query}>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto rounded-lg border border-surface-700/60 scrollbar-md"
          onKeyDown={handleKeyDown}
          {...NO_OVERSCROLL}
        >
          <div
            role="presentation"
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={item.key}
                  role="presentation"
                  className="absolute inset-x-0"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === "group" && (
                    <ProblemGroupRow
                      group={row.group}
                      expanded={expanded.has(row.group.id)}
                      onToggle={toggle}
                    />
                  )}
                  {row.kind === "object" && (
                    <ProblemObjectRow
                      object={row.object}
                      expanded={expanded.has(row.object.id)}
                      onToggle={toggle}
                    />
                  )}
                  {row.kind === "problem" && <ProblemRow problem={row.problem} />}
                </div>
              );
            })}
          </div>
        </div>
      </ProblemsBody>
    </div>
  );
}

interface ProblemsBodyProps {
  empty: boolean;
  filteredOut: boolean;
  query: string;
  children: ReactNode;
}

/** The list, or the reason there is none to draw. */
function ProblemsBody({ empty, filteredOut, query, children }: ProblemsBodyProps) {
  if (empty) {
    return (
      <EmptyState
        className="flex-1"
        icon={<CheckCircleIcon weight="duotone" className="h-10 w-10 text-success-text" />}
        title="All good"
        description="The linter found no problems in this project"
      />
    );
  }

  if (filteredOut) {
    return (
      <EmptyState
        className="flex-1"
        title="No matches"
        description={`Nothing matches "${query}"`}
      />
    );
  }

  return children;
}

function rowHeight(kind: RowModel["kind"] | undefined) {
  if (kind === "group") return GROUP_ROW_HEIGHT;
  if (kind === "object") return OBJECT_ROW_HEIGHT;
  return PROBLEM_ROW_HEIGHT;
}

function unreadableTitle(count: number) {
  if (count === 1) return "1 file could not be read";
  return `${count} files could not be read`;
}
