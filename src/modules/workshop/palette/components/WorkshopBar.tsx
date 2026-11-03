import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Badge, ChromePortal } from "@/components";
import { useClickOutside } from "@/hooks";
import { m } from "@/i18n";
import { ariaShortcutOf, useKeys } from "@/modules/keys";
import { twMerge } from "@/utils";

import { useRevealGameSearch } from "../../gameBrowser";
import { useRequestGridFocus } from "../../hooks";
import { WorkshopFilterPopover } from "../../projects/components/WorkshopFilterPopover";
import { useFilteredProjects } from "../../projects/hooks/useFilteredProjects";
import { useOptionalProjectContext } from "../../projects/state/ProjectContext";
import { useSetWorkshopSearchQuery, useWorkshopSearchQuery } from "../../state";
import { usePaletteRevealTarget } from "../state/paletteReveal";
import { type BarIntent, barMode, barPlaceholder } from "../utils/barMode";
import { prefixScope } from "../utils/sources";
import type { PaletteSourceId } from "../utils/types";
import { NavigationArrows } from "./NavigationArrows";
import { ProjectPalette } from "./ProjectPalette";
import { useOpenProject } from "./projectRows";
import type { PaletteBranchProps } from "./ResultsPalette";
import { WorkshopPalette } from "./WorkshopPalette";

const BOX =
  "flex size-full items-center gap-1.5 rounded-md border bg-surface-900 pl-2.5 transition-colors";

interface WorkshopBarProps {
  /** What the header draws at the end of the field, behind a divider. */
  actions?: ReactNode;
  /** What the header draws behind the field, across from the history arrows. */
  trailing?: ReactNode;
}

/**
 * The workshop's bar, drawn in the title bar's middle behind the history arrows: where you
 * are, and the route to everything in front of you.
 *
 * Per "The bar" in `docs/ux/WORKSHOP.md`.
 */
export function WorkshopBar({ actions, trailing }: WorkshopBarProps) {
  const project = useOptionalProjectContext();
  const openProject = useOpenProject();
  const requestGridFocus = useRequestGridFocus();

  const [intent, setIntent] = useState<BarIntent | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<PaletteSourceId | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const mode = barMode(intent, project !== null, scope);

  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const searchQuery = useWorkshopSearchQuery();
  const setSearchQuery = useSetWorkshopSearchQuery();
  const filtered = useFilteredProjects();

  /* The idle bar is unmounted while the bar is open, so its trigger has no
     element to focus until the close has rendered. */
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (intent !== null || !restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus();
  }, [intent]);

  /* Reached by opening the bar and by dropping a scope back onto the grid, and
     both want the caret in the box with whatever is there already selected. */
  useEffect(() => {
    if (mode === "filter") filterRef.current?.select();
  }, [mode]);

  const close = useCallback(() => {
    restoreFocus.current = true;
    setIntent(null);
    setQuery("");
    setScope(null);
  }, []);

  /* A click and the keys that stand for one, which is the palette on its own
     listing rather than a box waiting to be typed into. */
  const openWith = useCallback((next: PaletteSourceId | null) => {
    setQuery("");
    setScope(next);
    setIntent("palette");
  }, []);

  const openFilter = useCallback(() => {
    setQuery("");
    setScope(null);
    setIntent("filter");
    /* Where the box is already mounted the mode does not move, so the effect
       above never runs - and a Ctrl+F out of the grid has to reach the box. */
    filterRef.current?.select();
  }, []);

  /* The sort and filter popover is drawn in a portal, so a click inside it lands
     outside this box and would read as a click away from the bar - which drops
     the query and hands focus back to the idle trigger, mid-flow. It is the
     bar's own popup, so while it is open the bar has not been left. */
  useClickOutside(boxRef, close, intent !== null && !filterOpen);

  /* The route in from the editor, where `Ctrl+F` over a bin tab means the rows
     of that tab rather than a box the document holds. */
  usePaletteRevealTarget(openWith);

  /* `workshop.filter` holds over the grid alone, where the bar is the only box the key could
     mean. In a project's editor `editor.find` routes the key to the active document. */
  useKeys("workshop", {
    "workshop.palette": () => openWith(null),
    "workshop.projects": () => openWith("projects"),
    "workshop.commands": () => openWith("commands"),
    "workshop.filter": openFilter,
  });

  /* One text across the two modes. What a prefix reaches past moves into the
     palette's own query, and a dropped scope hands it back to the grid. */
  const handleFilterChange = useCallback(
    (next: string) => {
      const prefixed = prefixScope(next);
      if (prefixed) {
        setSearchQuery("");
        setQuery(next.slice(1));
        setScope(prefixed);
        return;
      }
      setSearchQuery(next);
    },
    [setSearchQuery],
  );

  /* A scope typed into the filter box borrowed the grid's text, so dropping it
     hands the text back. One opened as the palette never took it. */
  const removeScope = useCallback(() => {
    setScope(null);
    if (intent !== "filter") return;
    setSearchQuery(query);
    setQuery("");
  }, [intent, query, setSearchQuery]);

  const handleQueryChange = useCallback(
    (next: string) => {
      const prefixed = scope === null ? prefixScope(next) : null;
      if (prefixed) {
        setScope(prefixed);
        setQuery(next.slice(1));
        return;
      }
      setQuery(next);
    },
    [scope],
  );

  function handleFilterKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchQuery("");
      close();
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      setQuery(searchQuery);
      setSearchQuery("");
      setScope("projects");
      return;
    }

    /* One match is an answer rather than a list, so Enter takes it. */
    if (event.key === "Enter" && filtered.length === 1) {
      const only = filtered[0]!;
      event.preventDefault();
      close();
      openProject(only.id);
      return;
    }

    /* Several matches are the grid's to answer, and a down asks for the grid
       whatever the count. The bar stays as it is, because the box is still
       saying what the grid is showing. */
    if ((event.key === "Enter" || event.key === "ArrowDown") && filtered.length > 0) {
      event.preventDefault();
      requestGridFocus();
    }
  }

  const branch: PaletteBranchProps = {
    query,
    scope,
    onQueryChange: handleQueryChange,
    onQueryClear: () => setQuery(""),
    onScopeTo: setScope,
    onScopeRemove: removeScope,
    onClose: close,
  };

  return (
    <>
      {/* Drawn here rather than beside the box, so it is positioned against `main`,
          covers the editor and leaves the title bar alone. */}
      {mode === "palette" && (
        <div role="presentation" className="absolute inset-0 z-40 bg-scrim" onMouseDown={close} />
      )}

      {project && <ProjectKeys />}

      <ChromePortal slot="title">
        {/* The cap stops a wide window handing over a search box as wide. Under it the
            width is a claim on the free space, taken ahead of the title bar's two
            sides, which is what centres the row between them. */}
        <div
          data-ui="WorkshopBar:row"
          className="flex h-full max-w-[48rem] min-w-0 grow-[999] basis-0 items-center gap-1 px-3"
        >
          <NavigationArrows />

          <div
            ref={boxRef}
            data-ui="WorkshopBar"
            className="@container relative h-7 min-w-0 flex-1"
          >
            {mode === "idle" && (
              <IdleBar
                ref={triggerRef}
                onOpen={() => openWith(null)}
                onFilterOpenChange={setFilterOpen}
                actions={actions}
              />
            )}

            {mode === "filter" && (
              <FilterBox
                ref={filterRef}
                value={searchQuery}
                placeholder={barPlaceholder(mode, false, scope)}
                onChange={handleFilterChange}
                onKeyDown={handleFilterKeyDown}
                onFilterOpenChange={setFilterOpen}
                actions={actions}
              />
            )}

            {/* The title bar is a drag region, which takes an unmarked press inside it
                as a window drag rather than as a scroll. */}
            {mode === "palette" && (
              <div data-no-drag className="absolute inset-x-0 top-0 z-50">
                <PaletteBranch {...branch} />
              </div>
            )}
          </div>

          {trailing}
        </div>
      </ChromePortal>
    </>
  );
}

function PaletteBranch(props: PaletteBranchProps) {
  const project = useOptionalProjectContext();

  if (project) return <ProjectPalette {...props} />;
  return <WorkshopPalette {...props} />;
}

/* Mounted while a project is open, which is what makes the `project` scope active. The key
   answers while the bar is closed, so it is bound beside the bar rather than inside the palette
   it opens. */
function ProjectKeys() {
  const revealGameSearch = useRevealGameSearch();

  useKeys("project", { "project.findGame": revealGameSearch });

  return null;
}

interface IdleBarProps {
  onOpen: () => void;
  onFilterOpenChange: (open: boolean) => void;
  actions: ReactNode;
  ref: Ref<HTMLButtonElement>;
}

/* The crumb sits beside the trigger rather than inside it, because a control
   that opens the palette cannot also hold a link to somewhere else. */
function IdleBar({ onOpen, onFilterOpenChange, actions, ref }: IdleBarProps) {
  const project = useOptionalProjectContext();

  const name = project?.displayName ?? m.workshop_nav_label();
  const label =
    project === null
      ? m.workshop_bar_filter_label()
      : m.workshop_bar_search_label({ project: name });

  return (
    <div className={twMerge(BOX, "border-surface-600 pr-1.5 hover:border-accent-hover")}>
      <MagnifyingGlassIcon weight="bold" className="size-4 shrink-0 text-surface-400" />

      {project && (
        <>
          <Link
            to="/workshop"
            className="shrink-0 rounded-sm px-0.5 text-xs text-surface-400 transition-colors hover:text-surface-100"
          >
            {m.workshop_nav_label()}
          </Link>
          <span className="shrink-0 text-xs text-surface-500">/</span>
        </>
      )}

      {/* The name alone, so the trailing controls are theirs to click rather than
          this trigger's. It still covers the width between the two. */}
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        aria-label={label}
        aria-keyshortcuts={ariaShortcutOf("workshop.palette")}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center pl-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
      >
        <span className="truncate text-sm font-medium text-surface-100">{name}</span>
      </button>

      <VersionTag />
      <BarFilter onOpenChange={onFilterOpenChange} />
      <BarActions>{actions}</BarActions>
    </div>
  );
}

interface FilterBoxProps {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onFilterOpenChange: (open: boolean) => void;
  actions: ReactNode;
  ref: Ref<HTMLInputElement>;
}

function FilterBox({
  value,
  placeholder,
  onChange,
  onKeyDown,
  onFilterOpenChange,
  actions,
  ref,
}: FilterBoxProps) {
  return (
    <div className={twMerge(BOX, "border-accent-500 pr-1.5")}>
      <MagnifyingGlassIcon weight="bold" className="size-4 shrink-0 text-surface-400" />

      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={m.workshop_bar_filter_label()}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm text-surface-50 select-text placeholder:text-surface-400 focus:outline-none"
      />

      <VersionTag />
      <BarFilter onOpenChange={onFilterOpenChange} />
      <BarActions>{actions}</BarActions>
    </div>
  );
}

/* The sort and the filter of the grid the bar is drawn over. A project has no grid
   under it to sort. */
function BarFilter({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const project = useOptionalProjectContext();

  if (project) return null;
  return <WorkshopFilterPopover onOpenChange={onOpenChange} />;
}

/* Empty where the route offers no action, which hides the divider with it. The buttons are
   taller than the divider and overflow it. */
function BarActions({ children }: { children: ReactNode }) {
  return (
    <div
      data-ui="WorkshopBar:actions"
      className="-mr-1 flex h-4 shrink-0 items-center border-l border-surface-600 pl-1 empty:hidden"
    >
      {children}
    </div>
  );
}

/** The version of the open project. The list's own count is in its footer. */
function VersionTag() {
  const project = useOptionalProjectContext();

  if (!project) return null;

  return (
    <Badge size="md" className="shrink-0 @max-[14rem]:hidden">
      {m.workshop_bin_version_label({ version: project.version })}
    </Badge>
  );
}
