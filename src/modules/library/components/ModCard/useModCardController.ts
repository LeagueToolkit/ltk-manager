import { invoke } from "@tauri-apps/api/core";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import {
  useMoveModToFolder,
  useSkinhackFlag,
  useToggleMod,
  useUninstallMod,
} from "@/modules/library/api";
import { useModThumbnail } from "@/modules/library/api/useModThumbnail";
import { usePatcherStatus } from "@/modules/patcher";
import { useLibrarySelectionStore } from "@/stores";

const ROOT_FOLDER_ID = "root";

export interface ModCardProps {
  mod: InstalledMod;
  viewMode: "grid" | "list";
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

/**
 * View-model returned by {@link useModCardController}. Holds the derived display
 * flags, the UI state shared across the card root, toggle, menu, and dialog, and
 * the bound action handlers. The grid/list layouts and their leaf parts render
 * purely off this object.
 */
export interface ModCardView {
  mod: InstalledMod;
  thumbnailUrl: string | undefined;
  isFlagged: boolean;
  skinhackReason: string;
  disabled: boolean;
  interactionsDisabled: boolean;
  isInUserFolder: boolean;
  isMultiLayer: boolean;
  selectMode: boolean;
  isSelected: boolean;
  inSelectedState: boolean;
  inEnabledState: boolean;
  cursorClass: string;
  skinhackInfoOpen: boolean;
  setSkinhackInfoOpen: (open: boolean) => void;
  onCardClick: (e: React.MouseEvent) => void;
  onToggle: (modId: string, enabled: boolean) => void;
  onUninstall: () => void;
  onCopyId: () => void;
  onOpenLocation: () => void;
  onRemoveFromFolder: () => void;
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

/**
 * Owns all of a mod card's interaction logic and the UI state that must be shared
 * between the card body, toggle control, context menu, and skinhack dialog
 */
export function useModCardController({
  mod,
  onViewDetails,
  onEditMetadata,
}: ModCardProps): ModCardView {
  const { data: thumbnailUrl } = useModThumbnail(mod.id);
  const toast = useToast();
  const toggleMod = useToggleMod();
  const uninstallMod = useUninstallMod();
  const moveModToFolder = useMoveModToFolder();
  const { data: patcherStatus } = usePatcherStatus();

  const selectMode = useLibrarySelectionStore((s) => s.selectMode);
  const isSelected = useLibrarySelectionStore((s) => s.selectedIds.has(mod.id));
  const toggleSelection = useLibrarySelectionStore((s) => s.toggle);
  const selectRangeTo = useLibrarySelectionStore((s) => s.selectRangeTo);

  const {
    isFlagged,
    reason: skinhackReason,
    infoOpen: skinhackInfoOpen,
    setInfoOpen: setSkinhackInfoOpen,
  } = useSkinhackFlag(mod);

  const patcherRunning = patcherStatus?.running ?? false;
  const disabled = isFlagged || patcherRunning;
  const interactionsDisabled = disabled || selectMode;
  const isInUserFolder = mod.folderId != null && mod.folderId !== ROOT_FOLDER_ID;
  const isMultiLayer = mod.layers.length > 1;

  function handleToggle(modId: string, enabled: boolean) {
    toggleMod.mutate(
      { modId, enabled },
      { onError: (error) => console.error("Failed to toggle mod:", error.message) },
    );
  }

  function handleUninstall() {
    uninstallMod.mutate(mod.id, {
      onError: (error) => console.error("Failed to uninstall mod:", error.message),
    });
  }

  async function handleCopyId() {
    await navigator.clipboard.writeText(mod.id);
    toast.success("Copied mod ID to clipboard");
  }

  async function handleOpenLocation() {
    try {
      await invoke("reveal_in_explorer", { path: mod.modDir });
    } catch (error) {
      console.error("Failed to open location:", error);
    }
  }

  function handleRemoveFromFolder() {
    moveModToFolder.mutate({ modId: mod.id, folderId: ROOT_FOLDER_ID });
  }

  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) {
      return;
    }
    if (selectMode) {
      if (e.shiftKey) selectRangeTo(mod.id);
      else toggleSelection(mod.id);
      return;
    }
    if (disabled) return;
    handleToggle(mod.id, !mod.enabled);
  }

  const inSelectedState = selectMode && isSelected;
  const inEnabledState = mod.enabled && !isFlagged;
  const isInteractive = !isFlagged && (selectMode || !disabled);

  const cursorClass = match({ isFlagged, isInteractive })
    .with({ isFlagged: true }, () => "cursor-default opacity-50")
    .with({ isInteractive: true }, () => "cursor-pointer")
    .otherwise(() => "cursor-default");

  return {
    mod,
    thumbnailUrl,
    isFlagged,
    skinhackReason,
    disabled,
    interactionsDisabled,
    isInUserFolder,
    isMultiLayer,
    selectMode,
    isSelected,
    inSelectedState,
    inEnabledState,
    cursorClass,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
    onCardClick: handleCardClick,
    onToggle: handleToggle,
    onUninstall: handleUninstall,
    onCopyId: handleCopyId,
    onOpenLocation: handleOpenLocation,
    onRemoveFromFolder: handleRemoveFromFolder,
    onViewDetails,
    onEditMetadata,
  };
}
