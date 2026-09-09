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
import { useHotkeys } from "react-hotkeys-hook";

import { Kbd } from "@/components";
import { useClickOutside } from "@/hooks";
import { twMerge } from "@/utils";

import { useFilteredProjects } from "../api/useFilteredProjects";
import { useWorkshopProjects } from "../api/useWorkshopProjects";
import { useOptionalProjectContext } from "../components/ProjectContext";
import { WorkshopFilterPopover } from "../components/WorkshopFilterPopover";
import { useRevealGameSearch } from "../gameBrowser";
import { useRequestGridFocus } from "../hooks";
import { useSetWorkshopSearchQuery, useWorkshopSearchQuery } from "../state";
import { type BarIntent, barMode, barPlaceholder } from "./barMode";
import { ProjectPalette } from "./ProjectPalette";
import { useOpenProject } from "./projectRows";
import type { PaletteBranchProps } from "./ResultsPalette";
import { prefixScope } from "./sources";
import type { PaletteSourceId } from "./types";
import { WorkshopPalette } from "./WorkshopPalette";

const BOX =
  "flex h-full w-full items-center gap-1.5 rounded-md border bg-surface-900 pl-2.5 transition-colors";

/**
 * The header's middle: where you are, and the route to everything in front of you.
 *
 * Per "The bar" in `docs/ux/WORKSHOP.md`.
 */
export function WorkshopBar() {
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
  useHotkeys("ctrl+p, ctrl+k", () => openWith(null), {
    preventDefault: true,
    enableOnFormTags: true,
  });
  useHotkeys("ctrl+shift+p", () => openWith("commands"), {
    preventDefault: true,
    enableOnFormTags: true,
  });

  /* Only over the grid, where the bar is the only box the key could mean. A
     project's editor has boxes of its own, and each claims the key for itself. */
  useHotkeys(
    "ctrl+f",
    openFilter,
    { enabled: project === null, preventDefault: true, enableOnFormTags: true },
    [project, openFilter],
  );

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
      openProject(only.name);
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
      {/* Positioned against `main`, the one positioned ancestor above this, so
          the scrim covers the editor and leaves the title bar alone. */}
      {mode === "palette" && (
        <div
          role="presentation"
          data-no-drag
          className="absolute inset-0 z-40 bg-scrim"
          onMouseDown={close}
        />
      )}

      {project && <ProjectKeys />}

      {/* The cap is what stops a window twice as wide handing over a search box
          twice as wide, and the floor is where the box stops being one worth
          typing into. Between them the width is a claim on the free space rather
          than a basis, because a row breaks its lines on the basis: at 45rem the
          workshop's controls wrapped to a second line before the bar had shrunk
          by a pixel. Claimed first, behind a grow of 1 on each side, the bar
          reaches its cap wherever the row can spare it and hands width back to a
          side needing more than its share. */}
      <div
        ref={boxRef}
        data-ui="WorkshopBar"
        className="relative h-8 max-w-[45rem] min-w-[14rem] grow-[999] basis-0"
      >
        {mode === "idle" && (
          <IdleBar
            ref={triggerRef}
            onOpen={() => openWith(null)}
            onFilterOpenChange={setFilterOpen}
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
          />
        )}

        {/* The toolbar above is a drag region, which takes an unmarked press
            inside it as a window drag rather than as a scroll. */}
        {mode === "palette" && (
          <div data-no-drag className="absolute inset-x-0 top-0 z-50">
            <PaletteBranch {...branch} />
          </div>
        )}
      </div>
    </>
  );
}

function PaletteBranch(props: PaletteBranchProps) {
  const project = useOptionalProjectContext();

  if (project) return <ProjectPalette {...props} />;
  return <WorkshopPalette {...props} />;
}

/* The key answers while the bar is closed, so it is bound beside the bar rather
   than inside the palette it opens. */
function ProjectKeys() {
  const revealGameSearch = useRevealGameSearch();

  useHotkeys("ctrl+shift+f", revealGameSearch, {
    preventDefault: true,
    enableOnFormTags: true,
  });

  return null;
}

interface IdleBarProps {
  onOpen: () => void;
  onFilterOpenChange: (open: boolean) => void;
  ref: Ref<HTMLButtonElement>;
}

/* The crumb sits beside the trigger rather than inside it, because a control
   that opens the palette cannot also hold a link to somewhere else. */
function IdleBar({ onOpen, onFilterOpenChange, ref }: IdleBarProps) {
  const project = useOptionalProjectContext();

  const name = project?.displayName ?? "Workshop";
  const label = project === null ? "Filter the workshop" : `Search ${name}`;

  return (
    <div className={twMerge(BOX, "border-surface-600 pr-1.5 hover:border-accent-hover")}>
      <MagnifyingGlassIcon weight="bold" className="h-4 w-4 shrink-0 text-surface-400" />

      {project && (
        <>
          <Link
            to="/workshop"
            className="shrink-0 rounded-sm px-0.5 text-xs text-surface-400 transition-colors hover:text-surface-100"
          >
            Workshop
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
        aria-keyshortcuts="Control+P"
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center pl-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
      >
        <span className="truncate text-sm font-medium text-surface-100">{name}</span>
      </button>

      <BarTag />
      <BarFilter onOpenChange={onFilterOpenChange} />
      <Kbd shortcut="Ctrl+P" className="shrink-0 opacity-60" />
    </div>
  );
}

interface FilterBoxProps {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onFilterOpenChange: (open: boolean) => void;
  ref: Ref<HTMLInputElement>;
}

function FilterBox({
  value,
  placeholder,
  onChange,
  onKeyDown,
  onFilterOpenChange,
  ref,
}: FilterBoxProps) {
  return (
    <div className={twMerge(BOX, "border-accent-500 pr-1.5")}>
      <MagnifyingGlassIcon weight="bold" className="h-4 w-4 shrink-0 text-surface-400" />

      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Filter the workshop"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm text-surface-50 select-text placeholder:text-surface-400 focus:outline-none"
      />

      <BarTag />
      <BarFilter onOpenChange={onFilterOpenChange} />
    </div>
  );
}

/* The sort and the filter of the grid the bar is drawn over, so they sit with
   the count they move rather than in a slot of their own. A project has no grid
   under it to sort. */
function BarFilter({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const project = useOptionalProjectContext();

  if (project) return null;
  return <WorkshopFilterPopover onOpenChange={onOpenChange} />;
}

/** The version under a project, and what the grid is showing over it. */
function BarTag() {
  const project = useOptionalProjectContext();

  if (project) return <Tag>v{project.version}</Tag>;
  return <ProjectCount />;
}

function ProjectCount() {
  const { data: projects } = useWorkshopProjects();
  const filtered = useFilteredProjects();

  const total = projects?.length ?? 0;
  if (filtered.length !== total) return <Tag>{`${filtered.length} of ${total}`}</Tag>;
  return <Tag>{`${total} ${total === 1 ? "project" : "projects"}`}</Tag>;
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-surface-700 px-2 py-0.5 text-meta text-surface-400">
      {children}
    </span>
  );
}
