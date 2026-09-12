import {
  CheckIcon,
  EyeSlashIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  PackageIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { Accordion, Button, Dialog, RadioGroup } from "@/components";
import { m } from "@/i18n";
import { type IgnoredEntry, type PackResult, revealPath } from "@/lib/tauri";
import { useDialog } from "@/stores";
import { twMerge } from "@/utils";

import { usePackProject } from "../api/usePackProject";
import { useValidateProject } from "../api/useValidateProject";
import { ignoreRulesDocument } from "../documents";
import { usePackDialog, useWorkshopEditorStore } from "../state";

export function PackDialog() {
  const { isOpen: open, payload: project, close: closeDialog } = useDialog(usePackDialog);

  const packProject = usePackProject();
  const { data: validation, isLoading: validationLoading } = useValidateProject(
    project?.path ?? "",
    open,
  );

  const [format, setFormat] = useState<"modpkg" | "fantome">("modpkg");
  const [packResult, setPackResult] = useState<PackResult | null>(null);

  function handlePack() {
    if (!project) return;
    packProject.mutate(
      { projectPath: project.path, format },
      {
        onSuccess: setPackResult,
        onError: (err) => console.error("Failed to pack project:", err),
      },
    );
  }

  function handleClose() {
    closeDialog();
    setPackResult(null);
  }

  if (!project) return null;

  const hasErrors = validation && validation.errors.length > 0;
  const hasWarnings = validation && validation.warnings.length > 0;

  return (
    <Dialog.Shell
      open={open}
      onClose={handleClose}
      title={m.workshop_pack_title({ name: project.displayName })}
      size="lg"
    >
      <Dialog.Body>
        {packResult ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center py-4 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
                <CheckIcon weight="bold" className="h-8 w-8 text-success-text" />
              </div>
              <h3 className="text-lg font-semibold text-surface-100">
                {m.workshop_pack_created_title()}
              </h3>
              <p className="mt-2 text-sm font-medium text-surface-200">{packResult.fileName}</p>
              <p className="mt-1 max-w-sm text-xs break-all text-surface-400">
                {packResult.outputPath}
              </p>
            </div>

            {packResult.ignored.length > 0 && (
              <LeftOutDisclosure
                entries={packResult.ignored}
                projectPath={project.path}
                onOpenRules={handleClose}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {validationLoading ? (
              <div className="flex items-center gap-2 text-surface-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
                {m.workshop_pack_validating_label()}
              </div>
            ) : validation ? (
              <div className="flex flex-col gap-3">
                {hasErrors && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-danger-text">
                      <WarningCircleIcon weight="fill" className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        {m.workshop_pack_error_count({ count: validation.errors.length })}
                      </span>
                    </div>
                    <ul className="flex list-disc flex-col gap-1 pl-6 text-sm text-surface-300 marker:text-danger/70">
                      {validation.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {hasWarnings && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-warning-text">
                      <WarningIcon weight="fill" className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        {m.workshop_pack_warning_count({ count: validation.warnings.length })}
                      </span>
                    </div>
                    <ul className="flex list-disc flex-col gap-1 pl-6 text-sm text-surface-300 marker:text-warning/70">
                      {validation.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {validation.valid && !hasWarnings && (
                  <div className="flex items-center gap-2 text-success-text">
                    <CheckIcon weight="bold" className="h-4 w-4" />
                    <span className="text-sm">{m.workshop_pack_valid_label()}</span>
                  </div>
                )}
              </div>
            ) : null}

            <RadioGroup.Root
              value={format}
              onValueChange={(value: unknown) => setFormat(value as "modpkg" | "fantome")}
            >
              <RadioGroup.Label>{m.workshop_pack_format_label()}</RadioGroup.Label>
              <RadioGroup.Options>
                <RadioGroup.Card
                  value="modpkg"
                  title=".modpkg"
                  description={m.workshop_pack_modpkg_description()}
                />
                <RadioGroup.Card
                  value="fantome"
                  title=".fantome"
                  description={m.workshop_pack_fantome_description()}
                />
              </RadioGroup.Options>
            </RadioGroup.Root>

            {format === "fantome" && project.layers.length > 1 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                <WarningIcon weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" />
                <div className="text-warning-text">
                  {m.workshop_pack_fantome_layers_hint({ count: project.layers.length })}
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        {packResult ? (
          <>
            <Button variant="ghost" onClick={handleClose}>
              {m.common_close_action()}
            </Button>
            <Button
              variant="filled"
              left={<FolderOpenIcon className="h-4 w-4" />}
              onClick={() => revealPath(packResult.outputPath)}
            >
              {m.workshop_pack_reveal_action()}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={handleClose}>
              {m.common_cancel_action()}
            </Button>
            <Button
              variant="filled"
              left={<PackageIcon className="h-4 w-4" />}
              onClick={handlePack}
              loading={packProject.isPending}
              disabled={hasErrors || validationLoading}
            >
              {packProject.isPending ? m.workshop_pack_packing_label() : m.workshop_pack_action()}
            </Button>
          </>
        )}
      </Dialog.Footer>
    </Dialog.Shell>
  );
}

interface LeftOutDisclosureProps {
  entries: readonly IgnoredEntry[];
  projectPath: string;
  onOpenRules: () => void;
}

/** What the ignore rules kept out of the package, over the document that decides it. */
function LeftOutDisclosure({ entries, projectPath, onOpenRules }: LeftOutDisclosureProps) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.path.localeCompare(b.path)),
    [entries],
  );

  /* Requested rather than opened, because the dialog also opens from the grid,
     where no editor is mounted. See `pendingDocuments`. */
  function openRules() {
    useWorkshopEditorStore.getState().requestDocument(projectPath, ignoreRulesDocument());
    onOpenRules();
  }

  return (
    <div data-ui="PackDialog:left-out" className="border-t border-surface-700/50 pt-2">
      <Accordion.Root className="-mx-2">
        <Accordion.Item value="left-out">
          <Accordion.Trigger className="rounded-md px-2 py-1.5">
            <EyeSlashIcon weight="bold" className="h-4 w-4 shrink-0 text-surface-400" />
            <span className="flex-1 text-sm font-medium text-surface-200">
              {m.workshop_pack_left_out_title()}
            </span>
            <span className="shrink-0 text-meta text-surface-400 tabular-nums">
              {entries.length}
            </span>
          </Accordion.Trigger>

          <Accordion.Panel>
            <div className="flex flex-col items-start gap-1.5 px-2 pt-1.5">
              <ul
                tabIndex={0}
                aria-label={m.workshop_pack_left_out_list_label()}
                className="max-h-44 w-full overflow-y-auto rounded-lg border border-surface-700 bg-surface-950/30 py-1 font-mono text-meta scrollbar-md focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none focus-visible:ring-inset"
              >
                {sorted.map((entry) => (
                  <LeftOutRow key={entry.path} entry={entry} />
                ))}
              </ul>

              <Button
                variant="ghost"
                size="xs"
                compact
                className="-ml-1.5"
                left={<EyeSlashIcon className="h-3.5 w-3.5 text-doc-ignore-text" />}
                onClick={openRules}
              >
                {m.workshop_ignore_title()}
              </Button>
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>
    </div>
  );
}

/** One path the rules held back, its folder end shortened before its name. */
function LeftOutRow({ entry }: { entry: IgnoredEntry }) {
  const { prefix, name } = splitPath(entry);
  const Glyph = entry.pruned ? FolderIcon : FileIcon;

  return (
    <li title={entry.path} className="flex items-center gap-2 px-2.5 py-1 text-surface-300">
      <Glyph
        weight={entry.pruned ? "fill" : "regular"}
        className="h-3.5 w-3.5 shrink-0 text-surface-500"
      />
      {prefix && <span className="truncate">{prefix}</span>}
      <span className={twMerge("truncate", prefix && "shrink-0")}>{name}</span>
    </li>
  );
}

/** A path cut at its last separator, so the folder end is what shortens. */
function splitPath(entry: IgnoredEntry): { prefix: string; name: string } {
  const cut = entry.path.lastIndexOf("/");
  const name = cut < 0 ? entry.path : entry.path.slice(cut + 1);

  return {
    prefix: cut < 0 ? "" : entry.path.slice(0, cut + 1),
    name: entry.pruned ? `${name}/` : name,
  };
}
