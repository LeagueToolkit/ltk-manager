import { EllipsisVertical, Package, Play, X } from "lucide-react";
import { type KeyboardEvent, type ReactElement, type ReactNode, useState } from "react";
import { match } from "ts-pattern";

import { Button, Checkbox, ContextMenu, IconButton, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { WorkshopProject } from "@/lib/tauri";
import { SuspectBadge } from "@/modules/diagnostics";
import { getTagLabel } from "@/modules/library";
import { useStopPatcher } from "@/modules/patcher";
import { useSettings } from "@/modules/settings";
import { usePatcherSessionStore } from "@/stores";
import { twMerge } from "@/utils";

import { useWorkshopSelectionStore, type ViewMode } from "../../state";
import { useWorkshopTestState } from "../../testing/api/useWorkshopTestState";
import { useProjectThumbnail } from "../api/useProjectThumbnail";
import { useProjectActions } from "../hooks/useProjectActions";
import { ProjectCardMenuItems, ProjectSelectionMenuItems } from "./ProjectCardMenuItems";

interface ProjectCardProps {
  project: WorkshopProject;
  viewMode: ViewMode;
  onEdit: (project: WorkshopProject) => void;
  /** The grid's roving stop, so `0` on the one card the tab order reaches. */
  tabIndex: number;
}

/** Which commands a card's right click opens: its own, or the selection's. */
type MenuScope = "card" | "selection";

/* Accent-500 rather than the dimmed one the pointer gets: DS-HOVER. */
const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none";

export function ProjectCard({ project, viewMode, onEdit, tabIndex }: ProjectCardProps) {
  const { data: thumbnailUrl } = useProjectThumbnail(project.path, project.thumbnailPath);

  const selected = useWorkshopSelectionStore((s) => s.selectedPaths.has(project.path));
  const selectedCount = useWorkshopSelectionStore((s) => s.selectedPaths.size);
  const toggle = useWorkshopSelectionStore((s) => s.toggle);
  const selectOnly = useWorkshopSelectionStore((s) => s.selectOnly);
  const [menuScope, setMenuScope] = useState<MenuScope>("card");

  const testState = useWorkshopTestState(project);
  const stopPatcher = useStopPatcher();
  const stopping = usePatcherSessionStore((s) => s.stopping);
  const actions = useProjectActions(project);

  const isPatcherActive = testState.kind !== "idle";
  const isTestingThis = testState.kind === "building-this" || testState.kind === "running-this";

  function handleStop() {
    stopPatcher.mutate();
  }

  /**
   * Which commands this press opens, decided before the pick moves under it.
   *
   * One picked card and this card are the same target, so its own menu is what
   * opens there - the richer of the two, and the only way to reach Rename.
   */
  function handleContextMenu() {
    if (selected && selectedCount > 1) {
      setMenuScope("selection");
      return;
    }
    setMenuScope("card");
    /* A session holds the files it was started over, and that set is not the
       user's to rewrite until it ends: "Selection, and a running session". */
    if (selected || isPatcherActive) return;
    selectOnly(project.path);
  }

  /* The kebab's popup is a descendant in the React tree, so its keys reach the
     card unless the press landed on the card itself. */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "F2" || event.target !== event.currentTarget) return;
    event.preventDefault();
    actions.handleOpenRenameDialog();
  }

  const testButton = renderTestButton({
    testState,
    onTest: actions.handleTestProject,
    onStop: handleStop,
    isStopping: stopping,
    isTesting: actions.isTesting,
  });

  const stopPill = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleStop();
      }}
      disabled={stopping}
      title={m.workshop_card_stop_test_label()}
      className="group/pill flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success-text transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {m.workshop_card_testing_label()}
      <X className="h-3 w-3 opacity-60 group-hover/pill:opacity-100" />
    </button>
  );

  const kebab = (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            icon={<EllipsisVertical className="h-4 w-4" />}
            variant="ghost"
            size={viewMode === "list" ? "sm" : "md"}
            compact={viewMode === "grid"}
            aria-label={m.workshop_card_options_label({ name: project.displayName })}
          />
        }
      />
      <Menu.Portal>
        <Menu.Positioner>
          <Menu.Popup>
            <ProjectCardMenuItems project={project} onEdit={onEdit} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );

  if (viewMode === "list") {
    const listBorderClass = isTestingThis
      ? "border-success/40"
      : selected
        ? "border-accent-500/40"
        : "border-surface-700";

    const row = (
      <div
        role="button"
        tabIndex={tabIndex}
        aria-label={project.displayName}
        className={twMerge(
          "group flex cursor-pointer items-center gap-4 rounded-lg border bg-surface-900 p-4 transition-[background-color,border-color] duration-150 ease-out hover:border-accent-hover hover:bg-surface-800",
          FOCUS_RING,
          listBorderClass,
          isPatcherActive && !isTestingThis && "opacity-50",
        )}
        onClick={() => onEdit(project)}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      />
    );

    return (
      <ProjectCardContextMenu card={row} scope={menuScope} project={project} onEdit={onEdit}>
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            size="md"
            checked={isPatcherActive ? isTestingThis : selected}
            onCheckedChange={() => toggle(project.path)}
            disabled={isPatcherActive}
          />
        </div>

        <div className="relative h-12 w-21 shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-surface-600 to-surface-700">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-lg font-bold text-surface-500">
                {project.displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-surface-100">
            <span className="truncate">{project.displayName}</span>
          </h3>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-surface-500">
            <span className="truncate">
              {m.workshop_card_meta_label({
                version: project.version,
                authors:
                  project.authors.map((a) => a.name).join(", ") ||
                  m.workshop_card_unknown_author_label(),
              })}
            </span>
            <OpenedFolderPath project={project} />
          </p>
          <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
            <ProjectPills project={project} max={3} />
            <SuspectBadge projectPath={project.path} />
          </div>
        </div>

        {isTestingThis && stopPill}

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {testButton}
          <Button
            variant="outline"
            size="sm"
            left={<Package className="h-4 w-4" />}
            onClick={actions.handleOpenPackDialog}
          >
            {m.workshop_pack_action()}
          </Button>
          {kebab}
        </div>
      </ProjectCardContextMenu>
    );
  }

  const gridBorderClass = isTestingThis
    ? "border-success/40"
    : selected
      ? "border-accent-500/40"
      : "border-surface-600";

  const card = (
    <div
      role="button"
      tabIndex={tabIndex}
      aria-label={project.displayName}
      className={twMerge(
        "sculpted-card group relative cursor-pointer overflow-hidden rounded-xl border bg-surface-900 shadow-concave transition-[background-color,border-color] duration-150 ease-out hover:border-accent-hover hover:bg-surface-800",
        FOCUS_RING,
        gridBorderClass,
        isPatcherActive && !isTestingThis && "opacity-50",
      )}
      onClick={() => onEdit(project)}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
    />
  );

  return (
    <ProjectCardContextMenu card={card} scope={menuScope} project={project} onEdit={onEdit}>
      <div
        className={twMerge(
          "absolute top-0 left-0 z-10 p-2",
          isPatcherActive ? "cursor-not-allowed" : "cursor-pointer",
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (!isPatcherActive && e.target === e.currentTarget) toggle(project.path);
        }}
      >
        <Checkbox
          size="md"
          checked={isPatcherActive ? isTestingThis : selected}
          onCheckedChange={() => toggle(project.path)}
          disabled={isPatcherActive}
        />
      </div>

      <div className="relative aspect-video overflow-hidden rounded-t-xl bg-linear-to-br from-surface-600 to-surface-700">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-4xl font-bold text-surface-400">
              {project.displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="sculpted-card-details flex items-start gap-1 p-3">
        {thumbnailUrl && (
          <span aria-hidden="true" className="sculpted-card-art">
            <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3
            title={project.location === "opened" ? project.path : undefined}
            className="mb-1 truncate text-sm font-medium text-surface-100"
          >
            {project.displayName}
          </h3>
          <div className="mb-1 flex flex-wrap items-center gap-1.5 empty:hidden">
            <ProjectPills project={project} max={3} />
            <SuspectBadge projectPath={project.path} />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <span>{m.workshop_card_version_label({ version: project.version })}</span>
            <span>•</span>
            <span className="flex-1 truncate">
              {project.authors.length > 0
                ? project.authors[0].name
                : m.workshop_card_unknown_label()}
            </span>
            {isTestingThis && stopPill}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>{kebab}</div>
      </div>
    </ProjectCardContextMenu>
  );
}

/**
 * The card's menu on its right click, over the whole card rather than a target.
 *
 * A press inside the selection opens what the selection carries, and a press
 * outside it collapses the pick onto this card and opens the card's own. Per
 * "The card" in `docs/ux/WORKSHOP.md`.
 *
 * Renders the card itself through `render`, so the trigger is the card and the
 * grid keeps addressing its cards by their position among its children.
 */
function ProjectCardContextMenu({
  card,
  scope,
  project,
  onEdit,
  children,
}: {
  card: ReactElement;
  scope: MenuScope;
  project: WorkshopProject;
  onEdit: (project: WorkshopProject) => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={card}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            {scope === "selection" && <ProjectSelectionMenuItems />}
            {scope === "card" && <ProjectCardMenuItems project={project} onEdit={onEdit} />}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

interface TestButtonArgs {
  testState: ReturnType<typeof useWorkshopTestState>;
  onTest: () => void;
  onStop: () => void;
  isStopping: boolean;
  isTesting: boolean;
}

function renderTestButton({
  testState,
  onTest,
  onStop,
  isStopping,
  isTesting,
}: TestButtonArgs): ReactNode {
  return match(testState)
    .with({ kind: "idle" }, () => (
      <Button
        variant="outline"
        size="sm"
        left={<Play className="h-4 w-4" />}
        onClick={onTest}
        loading={isTesting}
      >
        {m.workshop_card_test_action()}
      </Button>
    ))
    .with({ kind: "building-this" }, () => (
      <Button variant="outline" size="sm" loading disabled>
        {m.workshop_card_building_label()}
      </Button>
    ))
    .with({ kind: "running-this" }, () => (
      <Button
        variant="outline"
        size="sm"
        onClick={onStop}
        loading={isStopping}
        disabled={isStopping}
        left={
          !isStopping && (
            <span className="inline-flex h-2 w-2 rounded-full bg-success shadow-[0_0_6px_2px] shadow-success/60" />
          )
        }
        className="border-success/40 bg-success/10 text-success-text hover:border-success/60 hover:bg-success/20"
      >
        {isStopping ? m.workshop_card_stopping_label() : m.workshop_card_stop_test_action()}
      </Button>
    ))
    .with({ kind: "building-other" }, { kind: "running-other" }, ({ otherLabel }) => (
      <Tooltip content={m.workshop_card_test_blocked_hint({ name: otherLabel })}>
        <Button variant="outline" size="sm" disabled left={<Play className="h-4 w-4" />}>
          {m.workshop_card_test_action()}
        </Button>
      </Tooltip>
    ))
    .with({ kind: "building-library" }, { kind: "running-library" }, () => (
      <Tooltip content={m.workshop_card_test_patcher_hint()}>
        <Button variant="outline" size="sm" disabled left={<Play className="h-4 w-4" />}>
          {m.workshop_card_test_action()}
        </Button>
      </Tooltip>
    ))
    .exhaustive();
}

function ProjectPills({
  project,
  max,
  className,
}: {
  project: WorkshopProject;
  max: number;
  className?: string;
}) {
  const { data: settings } = useSettings();

  const pills = [
    ...project.tags.map((t) => ({ label: getTagLabel(t), color: "tag" as const })),
    ...project.champions.map((c) => ({ label: c, color: "champion" as const })),
  ];
  if (pills.length === 0) return null;
  if (settings && !settings.showModTags) return null;

  const visible = pills.slice(0, max);
  const overflow = pills.length - max;

  // Same categorical hues as the library's ModPills.
  const colorClasses = {
    tag: "bg-accent-500/15 text-accent-400",
    champion: "bg-cat-champion/15 text-cat-champion-text",
  } as const;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {visible.map((pill) => (
        <span
          key={`${pill.color}:${pill.label}`}
          className={`rounded px-1.5 py-0.5 text-[0.625rem] leading-tight ${colorClasses[pill.color]}`}
        >
          {pill.label}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[0.625rem] text-surface-500">
          {m.workshop_card_pills_overflow_label({ count: overflow })}
        </span>
      )}
    </div>
  );
}

/* Truncated from the left, so the folder name, which tells two paths apart, stays. */
function OpenedFolderPath({ project }: { project: WorkshopProject }) {
  if (project.location !== "opened") return null;

  return (
    <>
      <span aria-hidden="true">•</span>
      <span
        title={project.path}
        className="min-w-24 flex-1 truncate text-left font-mono text-code select-text [direction:rtl]"
      >
        <bdi>{project.path}</bdi>
      </span>
    </>
  );
}
