import { useState } from "react";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import { api, type InstalledMod, type ModStorage } from "@/lib/tauri";
import {
  useMoveModToFolder,
  useSetModStorage,
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
  /** Why this mod is unusable, or `null` when it is fine. */
  faultReason: string | null;
  /**
   * Whether this mod can be moved between the two storage modes at all.
   *
   * A modpkg has no unpacked form, and either direction needs the archive still
   * beside the mod to convert against.
   */
  canChangeStorage: boolean;
  storageChangePending: boolean;
  disabled: boolean;
  interactionsDisabled: boolean;
  /**
   * Whether the card's menu is closed to the reader.
   *
   * Narrower than [`interactionsDisabled`], which also covers a mod that cannot
   * be switched on. A quarantined mod cannot be switched on and never will be,
   * so if that closed its menu too there would be no way left to reveal what
   * quarantine is holding or to drop the entry.
   */
  menuDisabled: boolean;
  isInUserFolder: boolean;
  isMultiLayer: boolean;
  selectMode: boolean;
  isSelected: boolean;
  inSelectedState: boolean;
  inEnabledState: boolean;
  /** Whether the mod cannot be used at all, which is not the same as being off. */
  blocked: boolean;
  isInteractive: boolean;
  cursorClass: string;
  skinhackInfoOpen: boolean;
  setSkinhackInfoOpen: (open: boolean) => void;
  faultInfoOpen: boolean;
  setFaultInfoOpen: (open: boolean) => void;
  wadFootprintOpen: boolean;
  setWadFootprintOpen: (open: boolean) => void;
  onCardClick: (e: React.MouseEvent) => void;
  onCardKeyDown: (e: React.KeyboardEvent) => void;
  onToggle: (modId: string, enabled: boolean) => void;
  onUninstall: () => void;
  onSetStorage: (storage: ModStorage) => void;
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
  const setModStorage = useSetModStorage();
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

  const faultReason = mod.fault?.error ?? null;
  const [faultInfoOpen, setFaultInfoOpen] = useState(false);
  const [wadFootprintOpen, setWadFootprintOpen] = useState(false);
  const patcherRunning = patcherStatus?.running ?? false;
  const disabled = isFlagged || faultReason !== null || patcherRunning;
  const interactionsDisabled = disabled || selectMode;
  // Select mode is a mode over the whole grid, and a patcher run owns the
  // library. Being unusable is neither, and is the state most in need of a menu.
  const menuDisabled = patcherRunning || selectMode;
  const isInUserFolder = mod.folderId != null && mod.folderId !== ROOT_FOLDER_ID;
  const isMultiLayer = mod.layers.length > 1;

  const canChangeStorage = mod.format === "fantome" && mod.hasArchive && faultReason === null;

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

  /* Success is announced by `useModStorageToast`, off the backend's own report,
     so the toast can track the conversion rather than only its end. */
  function handleSetStorage(storage: ModStorage) {
    if (!canChangeStorage || storage === mod.storage) return;
    setModStorage.mutate(
      { modId: mod.id, storage },
      {
        onError: (error) => toast.error("Could not change how this mod is stored", error.message),
      },
    );
  }

  async function handleCopyId() {
    await navigator.clipboard.writeText(mod.id);
    toast.success("Copied mod ID to clipboard");
  }

  async function handleOpenLocation() {
    // A faulted mod's own directory is gone. What is left is what quarantine
    // holds, which is the folder someone opening it now wants.
    const path = mod.fault?.quarantineDir ?? mod.modDir;
    const result = await api.revealInExplorer(path);
    if (!result.ok) {
      console.error("Failed to open location:", result.error);
    }
  }

  function handleRemoveFromFolder() {
    moveModToFolder.mutate({ modId: mod.id, folderId: ROOT_FOLDER_ID });
  }

  /** The grid card has no toggle of its own, so the card itself is the control. */
  function activateCard(shiftKey: boolean) {
    if (selectMode) {
      if (shiftKey) selectRangeTo(mod.id);
      else toggleSelection(mod.id);
      return;
    }
    if (disabled) return;
    handleToggle(mod.id, !mod.enabled);
  }

  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) return;
    activateCard(e.shiftKey);
  }

  function handleCardKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) return;
    e.preventDefault();
    activateCard(e.shiftKey);
  }

  const blocked = isFlagged || faultReason !== null;
  const inSelectedState = selectMode && isSelected;
  const inEnabledState = mod.enabled && !blocked;
  const isInteractive = !blocked && (selectMode || !disabled);

  const cursorClass = match({ blocked, isInteractive })
    .with({ blocked: true }, () => "cursor-default opacity-50")
    .with({ isInteractive: true }, () => "cursor-pointer")
    .otherwise(() => "cursor-default");

  return {
    mod,
    thumbnailUrl,
    isFlagged,
    skinhackReason,
    faultReason,
    canChangeStorage,
    storageChangePending: setModStorage.isPending,
    disabled,
    interactionsDisabled,
    menuDisabled,
    isInUserFolder,
    isMultiLayer,
    selectMode,
    isSelected,
    inSelectedState,
    inEnabledState,
    blocked,
    isInteractive,
    cursorClass,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
    faultInfoOpen,
    setFaultInfoOpen,
    wadFootprintOpen,
    setWadFootprintOpen,
    onCardClick: handleCardClick,
    onCardKeyDown: handleCardKeyDown,
    onToggle: handleToggle,
    onUninstall: handleUninstall,
    onSetStorage: handleSetStorage,
    onCopyId: handleCopyId,
    onOpenLocation: handleOpenLocation,
    onRemoveFromFolder: handleRemoveFromFolder,
    onViewDetails,
    onEditMetadata,
  };
}
