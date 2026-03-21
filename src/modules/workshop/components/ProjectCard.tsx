import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  EllipsisVertical,
  FolderOpen,
  Package,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { twMerge } from "tailwind-merge";

import { Button, Checkbox, IconButton, Menu } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { getTagLabel } from "@/modules/library";
import { usePatcherStatus } from "@/modules/patcher";
import {
  usePatcherSessionStore,
  useWorkshopDialogsStore,
  useWorkshopSelectionStore,
} from "@/stores";

import { useProjectThumbnail } from "../api/useProjectThumbnail";
import { useTestProjects } from "../api/useTestProject";
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

  const { data: patcherStatus } = usePatcherStatus();
  const isPatcherActive = patcherStatus?.running ?? false;

  const testingProjects = usePatcherSessionStore((s) => s.testingProjects);
  const isTesting = useMemo(
    () => testingProjects.some((p) => p.path === project.path),
    [testingProjects, project.path],
  );

  const openPackDialog = useWorkshopDialogsStore((s) => s.openPackDialog);
  const openDeleteDialog = useWorkshopDialogsStore((s) => s.openDeleteDialog);

  const testProjects = useTestProjects();
  const isTestDisabled = isPatcherActive || testProjects.isPending;

  function handleTest() {
    testProjects.mutate(
      { projects: [{ path: project.path, displayName: project.displayName }] },
      { onError: (err) => console.error("Failed to test project:", err.message) },
    );
  }

  async function handleOpenLocation() {
    try {
      await invoke("reveal_in_explorer", { path: project.path });
    } catch (error) {
      console.error("Failed to open location:", error);
    }
  }

  const listBorderClass = isTesting
    ? "border-green-500/40"
    : selected
      ? "border-accent-500/40"
      : "border-surface-700";

  if (viewMode === "list") {
    return (
      <div
        className={twMerge(
          "group flex items-center gap-4 rounded-lg border bg-surface-900 p-4 transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out hover:-translate-y-px hover:border-surface-600 hover:shadow-md",
          listBorderClass,
          isPatcherActive && !isTesting && "opacity-50",
        )}
      >
        <Checkbox
          size="md"
          checked={isPatcherActive ? isTesting : selected}
          onCheckedChange={() => toggle(project.path)}
          disabled={isPatcherActive}
        />

        <div className="relative h-12 w-[5.25rem] shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-surface-700 to-surface-800">
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
          <h3
            className="group/title flex cursor-pointer items-center gap-1 font-medium text-surface-100 hover:text-accent-400"
            onClick={() => onEdit(project)}
          >
            <span className="truncate">{project.displayName}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100" />
          </h3>
          <p className="truncate text-sm text-surface-500">
            v{project.version} • {project.authors.map((a) => a.name).join(", ") || "Unknown author"}
          </p>
          <ProjectPills project={project} max={3} />
        </div>

        {isTesting && (
          <span className="shrink-0 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400">
            Testing
          </span>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            left={<Play className="h-4 w-4" />}
            onClick={handleTest}
            disabled={isTestDisabled}
          >
            Test
          </Button>
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
                  <Menu.Item
                    icon={<Play className="h-4 w-4" />}
                    onClick={handleTest}
                    disabled={isTestDisabled}
                  >
                    Test
                  </Menu.Item>
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
          <IconButton
            icon={<ChevronRight />}
            variant="ghost"
            size="sm"
            onClick={() => onEdit(project)}
          />
        </div>
      </div>
    );
  }

  const gridBorderClass = isTesting
    ? "border-green-500/40"
    : selected
      ? "border-accent-500/40"
      : "border-surface-600";

  return (
    <div
      className={twMerge(
        "group relative rounded-xl border bg-surface-800 transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out hover:-translate-y-px hover:border-surface-400 hover:shadow-md",
        gridBorderClass,
        isPatcherActive && !isTesting && "opacity-50",
      )}
    >
      <div
        className={twMerge(
          "absolute top-0 left-0 z-10 p-2",
          isPatcherActive ? "cursor-not-allowed" : "cursor-pointer",
        )}
        onClick={(e) => {
          if (!isPatcherActive && e.target === e.currentTarget) toggle(project.path);
        }}
      >
        <Checkbox
          size="md"
          checked={isPatcherActive ? isTesting : selected}
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
          <h3
            className="group/title mb-1 flex cursor-pointer items-center gap-1 text-sm font-medium text-surface-100 hover:text-accent-400"
            onClick={() => onEdit(project)}
          >
            <span className="line-clamp-1">{project.displayName}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100" />
          </h3>
          <ProjectPills project={project} max={3} className="mb-1" />
          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <span>v{project.version}</span>
            <span>•</span>
            <span className="flex-1 truncate">
              {project.authors.length > 0 ? project.authors[0].name : "Unknown"}
            </span>
            {isTesting && (
              <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                Testing
              </span>
            )}
          </div>
        </div>
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
                <Menu.Item
                  icon={<Play className="h-4 w-4" />}
                  onClick={handleTest}
                  disabled={isPatcherActive}
                >
                  Test
                </Menu.Item>
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
