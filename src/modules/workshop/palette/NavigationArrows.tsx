import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { IconButton, Tooltip } from "@/components";

import { useWorkshopProjects } from "../api/useWorkshopProjects";
import { useOptionalProjectContext } from "../components/ProjectContext";
import { contentEditors } from "../documents";
import { type HistoryEntry, useWorkshopEditorStore } from "../state";
import { restoreLocation, useHistoryReach, useNavigateHistory } from "../state";
import { useOpenProject } from "./projectRows";

/* The fourth and fifth mouse buttons, which every browser and file manager
   already spends on back and forward. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

/**
 * The two arrows that walk the workshop's navigation history.
 *
 * Per "The navigation history" in `docs/ux/WORKSHOP.md`.
 */
export function NavigationArrows() {
  const reach = useHistoryReach();
  const walk = useWalkHistory();

  const goBack = useCallback(() => walk(-1), [walk]);
  const goForward = useCallback(() => walk(1), [walk]);

  useHotkeys("alt+left", goBack, { preventDefault: true, enableOnFormTags: true });
  useHotkeys("alt+right", goForward, { preventDefault: true, enableOnFormTags: true });

  /**
   * The thumb buttons, taken off the webview before it walks its own history.
   *
   * Chromium navigates on the release rather than on the press, so preventing
   * the press alone left the walk to run and the webview to pop a route behind
   * it: the arrow reached the directory and the pop landed on the grid. Every
   * phase of the gesture is swallowed, and the release is what acts. Captured,
   * because a control that stops the event is not a control that meant to
   * spend the thumb buttons.
   */
  useEffect(() => {
    function walksHistory(event: MouseEvent): boolean {
      return event.button === MOUSE_BACK || event.button === MOUSE_FORWARD;
    }

    function swallow(event: MouseEvent) {
      if (walksHistory(event)) event.preventDefault();
    }

    function onMouseUp(event: MouseEvent) {
      if (!walksHistory(event)) return;
      event.preventDefault();
      if (event.button === MOUSE_BACK) goBack();
      else goForward();
    }

    window.addEventListener("mousedown", swallow, true);
    window.addEventListener("auxclick", swallow, true);
    window.addEventListener("mouseup", onMouseUp, true);
    return () => {
      window.removeEventListener("mousedown", swallow, true);
      window.removeEventListener("auxclick", swallow, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [goBack, goForward]);

  /* One control pair rather than two buttons that happen to be adjacent, so
     they read together and sit against the bar they belong to. */
  return (
    <div data-ui="NavigationArrows" className="flex shrink-0 items-center">
      <Arrow direction="back" entry={reach.back} onClick={goBack} />
      <Arrow direction="forward" entry={reach.forward} onClick={goForward} />
    </div>
  );
}

/**
 * Walk the stack, and follow it off this route when the stop is elsewhere.
 *
 * The store moves the index and hands the tab back to its group, which is as
 * far as it reaches. Routing is the other half, and a route it is already on
 * costs nothing to ask for.
 */
function useWalkHistory(): (delta: number) => void {
  const navigateHistory = useNavigateHistory();
  const navigate = useNavigate();
  const openProject = useOpenProject();
  const { data: projects } = useWorkshopProjects();

  return useCallback(
    (delta: number) => {
      const entry = navigateHistory(delta);
      if (entry === null) return;

      if (entry.kind === "list") {
        void navigate({ to: "/workshop" });
        return;
      }

      /* A stop holds the directory, and the route takes the slug. */
      const project = projects?.find((candidate) => candidate.path === entry.project);
      if (project) openProject(project.name);

      /* The store put the tab back. Where the stop names a directory inside an
         explorer, that is the other half of the same stop. */
      if (entry.location) restoreLocation(entry.location.explorerId, entry.location.path);
    },
    [navigate, navigateHistory, openProject, projects],
  );
}

interface ArrowProps {
  direction: "back" | "forward";
  /** What the arrow returns to, or null while it has nothing behind it. */
  entry: HistoryEntry | null;
  onClick: () => void;
}

function Arrow({ direction, entry, onClick }: ArrowProps) {
  const title = useStopTitle(entry);
  const back = direction === "back";
  const label = back ? "Back" : "Forward";

  const button = (
    <IconButton
      icon={
        back ? (
          <ArrowLeftIcon weight="bold" className="h-4 w-4" />
        ) : (
          <ArrowRightIcon weight="bold" className="h-4 w-4" />
        )
      }
      variant="ghost"
      size="sm"
      compact
      /* Narrower than it is tall: a square box puts 12px between two 16px
         glyphs, and the height is what holds the arrows against the bar. */
      className="w-6"
      disabled={entry === null}
      onClick={onClick}
      aria-label={label}
    />
  );

  if (entry === null) return button;

  return <Tooltip content={`${label} to ${title} (${back ? "Alt+←" : "Alt+→"})`}>{button}</Tooltip>;
}

/** The directory a location stop names, and null at the source's own root. */
function stopSegment(path: string): string | null {
  if (path.length === 0) return null;
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

/** What a stop is called: the grid by its own name, a document by its tab's. */
function useStopTitle(entry: HistoryEntry | null): string {
  const stop = entry?.kind === "document" ? entry : null;
  const here = useOptionalProjectContext();
  const { data: projects } = useWorkshopProjects();

  const document = useWorkshopEditorStore((s) =>
    stop ? (s.byProject[stop.project]?.documents[stop.documentId] ?? null) : null,
  );
  const project = projects?.find((candidate) => candidate.path === stop?.project) ?? null;
  const editors = useMemo(() => (project ? contentEditors(project) : null), [project]);

  if (entry === null || entry.kind === "list") return "the workshop";
  if (!project || !editors || !document) return "where you were";

  /* The registry narrows to one kind per key, which a lookup by a union's own
     kind cannot express. The key comes off the document, so the two agree. */
  const definition = editors[document.kind] as {
    label: (document: never) => { title: string };
  };
  /* A directory stop names the directory, since several of them share one tab
     and its title alone would not tell a reader which one they are going to. */
  const title = entry.location
    ? (stopSegment(entry.location.path) ?? definition.label(document as never).title)
    : definition.label(document as never).title;

  return project.path === here?.path ? title : `${title} in ${project.displayName}`;
}
