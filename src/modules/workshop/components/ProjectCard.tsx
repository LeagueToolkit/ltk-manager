import { invoke } from "@tauri-apps/api/core";
import { EllipsisVertical, FolderOpen, Package, Pencil, Play, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import { Button, Checkbox, IconButton, Menu, Tooltip } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { getTagLabel } from "@/modules/library";
import { useStopPatcher } from "@/modules/patcher";
import { useWorkshopDialogsStore, useWorkshopSelectionStore } from "@/stores";

import { useProjectThumbnail } from "../api/useProjectThumbnail";
import { useTestProjects } from "../api/useTestProject";
import { useWorkshopTestState } from "../api/useWorkshopTestState";
import type { ViewMode } from "./WorkshopToolbar";

interface ProjectCardProps {
  project: WorkshopProject;
  viewMode: ViewMode;
  onEdit: (project: WorkshopProject) => void;
}

export function ProjectCard({ project, viewMode, onEdit }: ProjectCardProps) {
  const { data: thumbnailUrl } = useProjectThumbnail(project.path, project.thumbnailPath);

  const selected = useWorkshopSelectionStore((s) => s.selectedPaths.has(project.path));
  const toggle = useWorkshopSelectionStore((s) => s.toggle);

  const testState = useWorkshopTestState(project);
  const stopPatcher = useStopPatcher();
  const testProjects = useTestProjects();

  const isPatcherActive = testState.kind !== "idle";
  const isTestingThis = testState.kind === "building-this" || testState.kind === "running-this";

  const openPackDialog = useWorkshopDialogsStore((s) => s.openPackDialog);
  const openDeleteDialog = useWorkshopDialogsStore((s) => s.openDeleteDialog);

  function handleTest() {
    testProjects.mutate(
      { projects: [{ path: project.path, displayName: project.displayName }] },
      { onError: (err) => console.error("Failed to test project:", err.message) },
    );
  }

  function handleStop() {
    stopPatcher.mutate();
  }

  async function handleOpenLocation() {
    try {
      await invoke("reveal_in_explorer", { path: project.path });
    } catch (error) {
      console.error("Failed to open location:", error);
    }
  }

  const testButton = renderTestButton({
    testState,
    onTest: handleTest,
    onStop: handleStop,
    isStopping: stopPatcher.isPending,
    isTesting: testProjects.isPending,
  });

  const testMenuItem = renderTestMenuItem({
    testState,
    onTest: handleTest,
    onStop: handleStop,
  });

  const stopPill = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleStop();
      }}
      disabled={stopPatcher.isPending}
      title="Stop test"
      className="group/pill flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      Testing
      <X className="h-3 w-3 opacity-60 group-hover/pill:opacity-100" />
    </button>
  );

  const listBorderClass = isTestingThis
    ? "border-green-500/40"
    : selected
      ? "border-accent-500/40"
      : "border-surface-700";

  if (viewMode === "list") {
    return (
      <div
        className={twMerge(
          "group flex cursor-pointer items-center gap-4 rounded-lg border bg-surface-900 p-4 transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out hover:-translate-y-px hover:border-surface-600 hover:shadow-md",
          listBorderClass,
          isPatcherActive && !isTestingThis && "opacity-50",
        )}
        onClick={() => onEdit(project)}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            size="md"
            checked={isPatcherActive ? isTestingThis : selected}
            onCheckedChange={() => toggle(project.path)}
            disabled={isPatcherActive}
          />
        </div>

        <div className="relative h-12 w-21 shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-surface-700 to-surface-800">
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
          <p className="truncate text-sm text-surface-500">
            v{project.version} • {project.authors.map((a) => a.name).join(", ") || "Unknown author"}
          </p>
          <ProjectPills project={project} max={3} />
        </div>

        {isTestingThis && stopPill}

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {testButton}
          <Button
            variant="outline"
            size="sm"
            left={<Package className="h-4 w-4" />}
            onClick={() => openPackDialog(project)}
          >
            Pack
          </Button>
          <Menu.Root>
            <Menu.Trigger
              render={
                <IconButton
                  icon={<EllipsisVertical className="h-4 w-4" />}
                  variant="ghost"
                  size="sm"
                />
              }
            />
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup>
                  <Menu.Item icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(project)}>
                    Edit Project
                  </Menu.Item>
                  {testMenuItem}
                  <Menu.Item
                    icon={<Package className="h-4 w-4" />}
                    onClick={() => openPackDialog(project)}
                  >
                    Pack
                  </Menu.Item>
                  <Menu.Item icon={<FolderOpen className="h-4 w-4" />} onClick={handleOpenLocation}>
                    Open Location
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item
                    icon={<Trash2 className="h-4 w-4" />}
                    variant="danger"
                    onClick={() => openDeleteDialog(project)}
                  >
                    Delete
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
    );
  }

  const gridBorderClass = isTestingThis
    ? "border-green-500/40"
    : selected
      ? "border-accent-500/40"
      : "border-surface-600";

  return (
    <div
      className={twMerge(
        "group relative cursor-pointer rounded-xl border bg-surface-800 transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out hover:-translate-y-px hover:border-surface-400 hover:shadow-md",
        gridBorderClass,
        isPatcherActive && !isTestingThis && "opacity-50",
      )}
      onClick={() => onEdit(project)}
    >
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

      <div className="relative aspect-video overflow-hidden rounded-t-xl bg-linear-to-br from-surface-700 to-surface-800">
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

      <div className="flex items-start gap-1 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="mb-1 text-sm font-medium text-surface-100">
            <span className="line-clamp-1">{project.displayName}</span>
          </h3>
          <ProjectPills project={project} max={3} className="mb-1" />
          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <span>v{project.version}</span>
            <span>•</span>
            <span className="flex-1 truncate">
              {project.authors.length > 0 ? project.authors[0].name : "Unknown"}
            </span>
            {isTestingThis && stopPill}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Menu.Root>
            <Menu.Trigger
              render={<IconButton icon={<EllipsisVertical />} variant="ghost" size="md" compact />}
            />
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup>
                  <Menu.Item icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(project)}>
                    Edit Project
                  </Menu.Item>
                  {testMenuItem}
                  <Menu.Item
                    icon={<Package className="h-4 w-4" />}
                    onClick={() => openPackDialog(project)}
                  >
                    Pack
                  </Menu.Item>
                  <Menu.Item icon={<FolderOpen className="h-4 w-4" />} onClick={handleOpenLocation}>
                    Open Location
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item
                    icon={<Trash2 className="h-4 w-4" />}
                    variant="danger"
                    onClick={() => openDeleteDialog(project)}
                  >
                    Delete
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
    </div>
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
        Test
      </Button>
    ))
    .with({ kind: "building-this" }, () => (
      <Button variant="outline" size="sm" loading disabled>
        Building…
      </Button>
    ))
    .with({ kind: "running-this" }, () => (
      <Button
        variant="outline"
        size="sm"
        onClick={onStop}
        loading={isStopping}
        left={
          !isStopping && (
            <span className="inline-flex h-2 w-2 rounded-full bg-green-500 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)]" />
          )
        }
        className="border-green-500/40 bg-green-500/10 text-green-400 hover:border-green-500/60 hover:bg-green-500/20"
      >
        {isStopping ? "Stopping…" : "Stop Test"}
      </Button>
    ))
    .with({ kind: "building-other" }, { kind: "running-other" }, ({ otherLabel }) => (
      <Tooltip content={`Testing "${otherLabel}" — stop it first`}>
        <Button variant="outline" size="sm" disabled left={<Play className="h-4 w-4" />}>
          Test
        </Button>
      </Tooltip>
    ))
    .with({ kind: "building-library" }, { kind: "running-library" }, () => (
      <Tooltip content="Patcher is running — stop it first">
        <Button variant="outline" size="sm" disabled left={<Play className="h-4 w-4" />}>
          Test
        </Button>
      </Tooltip>
    ))
    .exhaustive();
}

interface TestMenuItemArgs {
  testState: ReturnType<typeof useWorkshopTestState>;
  onTest: () => void;
  onStop: () => void;
}

function renderTestMenuItem({ testState, onTest, onStop }: TestMenuItemArgs): ReactNode {
  return match(testState)
    .with({ kind: "idle" }, () => (
      <Menu.Item icon={<Play className="h-4 w-4" />} onClick={onTest}>
        Test
      </Menu.Item>
    ))
    .with({ kind: "building-this" }, () => (
      <Menu.Item icon={<Play className="h-4 w-4" />} disabled>
        Building…
      </Menu.Item>
    ))
    .with({ kind: "running-this" }, () => (
      <Menu.Item icon={<Play className="h-4 w-4" />} onClick={onStop}>
        Stop Test
      </Menu.Item>
    ))
    .with(
      { kind: "building-other" },
      { kind: "running-other" },
      { kind: "building-library" },
      { kind: "running-library" },
      () => (
        <Menu.Item icon={<Play className="h-4 w-4" />} disabled>
          Test
        </Menu.Item>
      ),
    )
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
  const pills = [
    ...project.tags.map((t) => ({ label: getTagLabel(t), color: "brand" as const })),
    ...project.champions.map((c) => ({ label: c, color: "emerald" as const })),
  ];
  if (pills.length === 0) return null;

  const visible = pills.slice(0, max);
  const overflow = pills.length - max;

  const colorClasses = {
    brand: "bg-accent-500/15 text-accent-400",
    emerald: "bg-emerald-500/15 text-emerald-400",
  } as const;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {visible.map((pill) => (
        <span
          key={`${pill.color}:${pill.label}`}
          className={`rounded px-1.5 py-0.5 text-[10px] leading-tight ${colorClasses[pill.color]}`}
        >
          {pill.label}
        </span>
      ))}
      {overflow > 0 && <span className="text-[10px] text-surface-500">+{overflow}</span>}
    </div>
  );
}
