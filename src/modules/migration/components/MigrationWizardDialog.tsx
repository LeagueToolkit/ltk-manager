import { FolderOpen, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Checkbox, Dialog, Progress } from "@/components";
import type { CslolModInfo, MigrationProgress } from "@/lib/tauri";
import { BulkInstallResults } from "@/modules/library";

import { useMigrationWizard, type WizardStep } from "../api";

interface MigrationWizardDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MigrationWizardDialog({ open: isOpen, onClose }: MigrationWizardDialogProps) {
  const wizard = useMigrationWizard(onClose);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && wizard.handleClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="lg">
          <Dialog.Header>
            <Dialog.Title>{getStepTitle(wizard.step)}</Dialog.Title>
            {wizard.step !== "importing" && <Dialog.Close />}
          </Dialog.Header>

          <Dialog.Body className="space-y-4">
            {wizard.step === "browse" && (
              <BrowseStep
                onBrowse={wizard.handleBrowse}
                isScanning={wizard.isScanning}
                error={wizard.scanError}
              />
            )}
            {wizard.step === "select" && (
              <SelectStep
                mods={wizard.mods}
                selectedFolders={wizard.selectedFolders}
                onToggle={wizard.handleToggleMod}
                onSelectAll={wizard.handleSelectAll}
                onSelectNone={wizard.handleSelectNone}
              />
            )}
            {wizard.step === "importing" && <MigrationImportProgress progress={wizard.progress} />}
            {wizard.step === "results" && wizard.importResult && (
              <BulkInstallResults result={wizard.importResult} verb="imported" />
            )}
          </Dialog.Body>

          <Dialog.Footer>
            {wizard.step === "browse" && (
              <Button variant="outline" size="sm" onClick={wizard.handleClose}>
                Cancel
              </Button>
            )}
            {wizard.step === "select" && (
              <>
                <Button variant="outline" size="sm" onClick={() => wizard.setStep("browse")}>
                  Back
                </Button>
                <Button
                  variant="filled"
                  size="sm"
                  onClick={wizard.handleImport}
                  disabled={wizard.selectedFolders.size === 0}
                >
                  Import {wizard.selectedFolders.size} Mod
                  {wizard.selectedFolders.size !== 1 ? "s" : ""}
                </Button>
              </>
            )}
            {wizard.step === "results" && (
              <Button variant="filled" size="sm" onClick={wizard.handleClose}>
                Done
              </Button>
            )}
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function getStepTitle(step: WizardStep): string {
  switch (step) {
    case "browse":
      return "Import from cslol-manager";
    case "select":
      return "Select Mods to Import";
    case "importing":
      return "Importing Mods...";
    case "results":
      return "Import Complete";
  }
}

// Step sub-components

interface BrowseStepProps {
  onBrowse: () => void;
  isScanning: boolean;
  error?: string;
}

function BrowseStep({ onBrowse, isScanning, error }: BrowseStepProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-surface-300">
        Select your cslol-manager installation directory. LTK Manager will scan for installed mods
        and let you choose which ones to import.
      </p>
      <p className="text-sm text-surface-400">
        The directory should contain an{" "}
        <code className="rounded bg-surface-700 px-1.5 py-0.5 text-surface-200">installed</code>{" "}
        folder with your mods.
      </p>
      <Button variant="outline" size="sm" onClick={onBrowse} disabled={isScanning}>
        {isScanning && (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning...
          </span>
        )}
        {!isScanning && (
          <span className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Browse...
          </span>
        )}
      </Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

interface SelectStepProps {
  mods: CslolModInfo[];
  selectedFolders: Set<string>;
  onToggle: (folderName: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

function SelectStep({
  mods,
  selectedFolders,
  onToggle,
  onSelectAll,
  onSelectNone,
}: SelectStepProps) {
  const [search, setSearch] = useState("");

  const filteredMods = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return mods;
    return mods.filter(
      (mod) => mod.name.toLowerCase().includes(query) || mod.author?.toLowerCase().includes(query),
    );
  }, [mods, search]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-surface-300">
          {selectedFolders.size} of {mods.length} mod{mods.length !== 1 ? "s" : ""} selected
          {search.trim() && ` \u00b7 Showing ${filteredMods.length} of ${mods.length}`}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onSelectAll}>
            All
          </Button>
          <Button variant="ghost" size="sm" onClick={onSelectNone}>
            None
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-surface-500" />
        <input
          type="text"
          placeholder="Search mods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-surface-600 bg-surface-800 py-2 pr-4 pl-10 text-sm text-surface-100 placeholder:text-surface-500 focus:border-transparent focus:ring-2 focus:ring-accent-500 focus:outline-none"
        />
      </div>

      <div className="max-h-96 space-y-1 overflow-y-auto rounded-lg border border-surface-700 p-2">
        {filteredMods.length === 0 && (
          <p className="py-6 text-center text-sm text-surface-400">
            No mods matching &ldquo;{search.trim()}&rdquo;
          </p>
        )}
        {filteredMods.map((mod) => (
          <label
            key={mod.folderName}
            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-surface-700/50"
          >
            <Checkbox
              checked={selectedFolders.has(mod.folderName)}
              onCheckedChange={() => onToggle(mod.folderName)}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-surface-100">{mod.name}</span>
                {mod.version && (
                  <span className="shrink-0 text-xs text-surface-500">{mod.version}</span>
                )}
              </div>
              {mod.author && <p className="truncate text-xs text-surface-400">{mod.author}</p>}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function MigrationImportProgress({ progress }: { progress: MigrationProgress | null }) {
  if (!progress) {
    return (
      <Progress.Root value={null} label="Preparing import...">
        <Progress.Track>
          <Progress.Indicator />
        </Progress.Track>
      </Progress.Root>
    );
  }

  const phaseLabel = progress.phase === "packaging" ? "Packaging" : "Installing";

  return (
    <>
      <Progress.Root
        value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0}
        label={`${phaseLabel} ${progress.current} / ${progress.total}`}
      >
        <Progress.Track>
          <Progress.Indicator />
        </Progress.Track>
      </Progress.Root>
      <p className="truncate text-sm text-surface-400">{progress.currentFile}</p>
    </>
  );
}
