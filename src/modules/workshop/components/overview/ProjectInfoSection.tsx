import { Check, ChevronDown, ChevronRight, Info, Pencil, X } from "lucide-react";
import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { IconButton, useToast } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import { useRenameProject } from "@/modules/workshop";

interface ProjectInfoSectionProps {
  project: WorkshopProject;
  onRenamed: (newName: string) => void;
}

export function ProjectInfoSection({ project, onRenamed }: ProjectInfoSectionProps) {
  const renameProject = useRenameProject();
  const toast = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [slugValue, setSlugValue] = useState(project.name);

  function handleSaveSlug() {
    const trimmed = slugValue.trim();
    if (!trimmed || trimmed === project.name) {
      setIsEditingSlug(false);
      return;
    }
    renameProject.mutate(
      { projectPath: project.path, newName: trimmed },
      {
        onSuccess: (renamed) => {
          setIsEditingSlug(false);
          toast.success("Project renamed successfully");
          onRenamed(renamed.name);
        },
        onError: (err) => {
          toast.error(`Failed to rename: ${err.message}`);
        },
      },
    );
  }

  function handleCancelSlug() {
    setSlugValue(project.name);
    setIsEditingSlug(false);
  }

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-5 py-3.5 text-left text-sm font-medium text-surface-300 transition-colors hover:text-surface-100"
      >
        <span className={twMerge("transition-transform duration-200", isOpen && "rotate-90")}>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <Info className="h-4 w-4 text-surface-400" />
        Project Info
      </button>

      {isOpen && (
        <div className="border-t border-surface-700/50 px-5 py-4">
          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-surface-400">Slug</dt>
              <dd className="flex items-center gap-2">
                {isEditingSlug ? (
                  <>
                    <input
                      type="text"
                      value={slugValue}
                      onChange={(e) => setSlugValue(e.target.value.toLowerCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveSlug();
                        if (e.key === "Escape") handleCancelSlug();
                      }}
                      autoFocus
                      className="w-48 rounded border border-surface-500 bg-surface-700 px-2 py-1 font-mono text-sm text-surface-200 focus:border-accent-500 focus:ring-1 focus:ring-accent-500 focus:outline-none"
                    />
                    <IconButton
                      icon={<Check className="h-3.5 w-3.5" />}
                      variant="ghost"
                      size="xs"
                      onClick={handleSaveSlug}
                      loading={renameProject.isPending}
                      aria-label="Save slug"
                    />
                    <IconButton
                      icon={<X className="h-3.5 w-3.5" />}
                      variant="ghost"
                      size="xs"
                      onClick={handleCancelSlug}
                      aria-label="Cancel editing"
                    />
                  </>
                ) : (
                  <>
                    <span className="font-mono text-surface-200">{project.name}</span>
                    <IconButton
                      icon={<Pencil className="h-3 w-3" />}
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setSlugValue(project.name);
                        setIsEditingSlug(true);
                      }}
                      aria-label="Edit slug"
                    />
                  </>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-surface-400">Path</dt>
              <dd className="max-w-sm truncate text-right font-mono text-surface-200">
                {project.path}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-surface-400">Last Modified</dt>
              <dd className="text-surface-200">
                {new Date(project.lastModified).toLocaleDateString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-surface-400">Layers</dt>
              <dd className="text-surface-200">{project.layers.length}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
