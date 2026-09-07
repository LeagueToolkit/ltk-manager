import { useState } from "react";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import { errorSummary } from "@/i18n";
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

/** Which commands a card's right click opens: its own, or the selection's. */
export type MenuScope = "card" | "selection";

type Modifiers = Pick<React.MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">;

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
  /**
   * Whether this mod can be moved between the two storage modes at all.
   *
   * A modpkg has no unpacked form. Unpacking reads the archive, so an archive
   * mod whose file is gone offers nothing; repacking packs the tree and needs
   * no archive.
   */
  canChangeStorage: boolean;
  storageChangePending: boolean;
  /** Whether the mod cannot be switched, because it is blocked or the patcher owns the library. */
  disabled: boolean;
  /**
   * Whether the card's menu is closed to the reader.
   *
   * Narrower than [`disabled`], which also covers a mod that cannot be switched
   * on. A blocked mod still needs its menu, or there would be no way left to
   * act on it.
   */
  menuDisabled: boolean;
  isInUserFolder: boolean;
  isMultiLayer: boolean;
  /** Whether anything at all is picked, which is what draws every card's checkbox. */
  hasSelection: boolean;
  isSelected: boolean;
  inEnabledState: boolean;
  /** Which commands the right click landed on, decided before the pick moved under it. */
  menuScope: MenuScope;
  /** Whether the mod cannot be used at all, which is not the same as being off. */
  blocked: boolean;
  isInteractive: boolean;
  cursorClass: string;
  skinhackInfoOpen: boolean;
  setSkinhackInfoOpen: (open: boolean) => void;
  wadFootprintOpen: boolean;
  setWadFootprintOpen: (open: boolean) => void;
  onCardClick: (e: React.MouseEvent) => void;
  onCardKeyDown: (e: React.KeyboardEvent) => void;
  onCardContextMenu: () => void;
  onSelectionToggle: () => void;
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

  const hasSelection = useLibrarySelectionStore((s) => s.selectedIds.size > 0);
  const isSelected = useLibrarySelectionStore((s) => s.selectedIds.has(mod.id));
  const toggleSelection = useLibrarySelectionStore((s) => s.toggle);
  const selectRangeTo = useLibrarySelectionStore((s) => s.selectRangeTo);
  const selectOnly = useLibrarySelectionStore((s) => s.selectOnly);
  const [menuScope, setMenuScope] = useState<MenuScope>("card");

  const {
    isFlagged,
    reason: skinhackReason,
    infoOpen: skinhackInfoOpen,
    setInfoOpen: setSkinhackInfoOpen,
  } = useSkinhackFlag(mod);

  const [wadFootprintOpen, setWadFootprintOpen] = useState(false);
  const patcherRunning = patcherStatus?.running ?? false;
  const disabled = isFlagged || patcherRunning;
  // A patcher run owns the library. Being unusable is not the same thing, and is
  // the state most in need of a menu.
  const menuDisabled = patcherRunning;
  const isInUserFolder = mod.folderId != null && mod.folderId !== ROOT_FOLDER_ID;
  const isMultiLayer = mod.layers.length > 1;

  // "Legacy is transient": ADR-0008.
  const canChangeStorage =
    mod.format === "fantome" && (mod.storage === "project" || mod.hasArchive) && mod.slug != null;

  function handleToggle(modId: string, enabled: boolean) {
    toggleMod.mutate(
      { modId, enabled },
      { onError: (error) => console.error("Failed to toggle mod:", error) },
    );
  }

  function handleUninstall() {
    uninstallMod.mutate(mod.id, {
      onError: (error) => console.error("Failed to uninstall mod:", error),
    });
  }

  /* Success is announced by `useModStorageToast`, off the backend's own report,
     so the toast can track the conversion rather than only its end. */
  function handleSetStorage(storage: ModStorage) {
    if (!canChangeStorage || storage === mod.storage) return;
    setModStorage.mutate(
      { modId: mod.id, storage },
      {
        onError: (error) =>
          toast.error("Could not change how this mod is stored", errorSummary(error)),
      },
    );
  }

  async function handleCopyId() {
    await navigator.clipboard.writeText(mod.id);
    toast.success("Copied mod ID to clipboard");
  }

  async function handleOpenLocation() {
    const result = await api.revealInExplorer(mod.modDir);
    if (!result.ok) {
      console.error("Failed to open location:", result.error);
    }
  }

  function handleRemoveFromFolder() {
    moveModToFolder.mutate({ modId: mod.id, folderId: ROOT_FOLDER_ID });
  }

  /**
   * The card's own gesture: a modifier picks, and a bare press switches the mod.
   *
   * Selecting is open to a mod that cannot be switched on, because uninstalling
   * it is the reason to reach for the checkbox in the first place.
   */
  function activateCard(e: Modifiers) {
    if (e.shiftKey) {
      selectRangeTo(mod.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSelection(mod.id);
      return;
    }
    if (disabled) return;
    handleToggle(mod.id, !mod.enabled);
  }

  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) return;
    activateCard(e);
  }

  function handleCardKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) return;
    e.preventDefault();
    activateCard(e);
  }

  /* Read before the pick moves, so a right click that collapses the selection
     onto this card still opens the card's own commands. */
  function handleCardContextMenu() {
    if (isSelected) {
      setMenuScope("selection");
      return;
    }
    setMenuScope("card");
    selectOnly(mod.id);
  }

  const blocked = isFlagged;
  const inEnabledState = mod.enabled && !blocked;
  const isInteractive = !blocked && !disabled;

  const cursorClass = match({ blocked, isInteractive })
    .with({ blocked: true }, () => "cursor-default opacity-50")
    .with({ isInteractive: true }, () => "cursor-pointer")
    .otherwise(() => "cursor-default");

  return {
    mod,
    thumbnailUrl,
    isFlagged,
    skinhackReason,
    canChangeStorage,
    storageChangePending: setModStorage.isPending,
    disabled,
    menuDisabled,
    isInUserFolder,
    isMultiLayer,
    hasSelection,
    isSelected,
    inEnabledState,
    menuScope,
    blocked,
    isInteractive,
    cursorClass,
    skinhackInfoOpen,
    setSkinhackInfoOpen,
    wadFootprintOpen,
    setWadFootprintOpen,
    onCardClick: handleCardClick,
    onCardKeyDown: handleCardKeyDown,
    onCardContextMenu: handleCardContextMenu,
    onSelectionToggle: () => toggleSelection(mod.id),
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
