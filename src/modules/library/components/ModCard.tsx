import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  Edit3,
  EllipsisVertical,
  FolderOpen,
  FolderX,
  Info,
  Layers,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Dialog, IconButton, Menu, Switch, Tooltip, useToast } from "@/components";
import type { InstalledMod, ModLayer } from "@/lib/tauri";
import {
  useEnableModWithLayers,
  useMoveModToFolder,
  useSkinhackFlag,
  useToggleMod,
  useUninstallMod,
} from "@/modules/library/api";
import { usePatcherStatus } from "@/modules/patcher";

const ROOT_FOLDER_ID = "root";
import { useModThumbnail } from "@/modules/library/api/useModThumbnail";
import { getTagLabel } from "@/modules/library/utils/labels";

import { LayerPickerPopover } from "./LayerPickerPopover";
import { WadCountBadge } from "./WadCountBadge";

interface ModCardProps {
  mod: InstalledMod;
  viewMode: "grid" | "list";
  onViewDetails?: (mod: InstalledMod) => void;
  onEditMetadata?: (mod: InstalledMod) => void;
}

export function ModCard({ mod, viewMode, onViewDetails, onEditMetadata }: ModCardProps) {
  const { data: thumbnailUrl } = useModThumbnail(mod.id);
  const toast = useToast();
  const toggleMod = useToggleMod();
  const uninstallMod = useUninstallMod();
  const enableWithLayers = useEnableModWithLayers();
  const moveModToFolder = useMoveModToFolder();
  const { data: patcherStatus } = usePatcherStatus();
  const [pickerOpen, setPickerOpen] = useState(false);

  const {
    isFlagged,
    reason: skinhackReason,
    infoOpen: skinhackInfoOpen,
    setInfoOpen: setSkinhackInfoOpen,
  } = useSkinhackFlag(mod);
  const patcherRunning = patcherStatus?.running ?? false;
  const disabled = isFlagged || patcherRunning;
  const isInUserFolder = mod.folderId != null && mod.folderId !== ROOT_FOLDER_ID;
  const isMultiLayer = mod.layers.length > 1;

  function handleToggle(modId: string, enabled: boolean) {
    if (enabled && !mod.enabled && isMultiLayer) {
      setPickerOpen(true);
      return;
    }
    toggleMod.mutate(
      { modId, enabled },
      { onError: (error) => console.error("Failed to toggle mod:", error.message) },
    );
  }

  function handlePickerConfirm(layerStates: Record<string, boolean>) {
    enableWithLayers.mutate(
      { modId: mod.id, layerStates },
      { onError: (error) => console.error("Failed to enable mod with layers:", error.message) },
    );
  }

  function handlePickerCancel() {
    setPickerOpen(false);
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

  function handleCardClick(e: React.MouseEvent) {
    if (disabled) return;
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) {
      return;
    }
    handleToggle(mod.id, !mod.enabled);
  }

  if (viewMode === "list") {
    return (
      <div
        onClick={handleCardClick}
        className={`flex items-center gap-4 rounded-lg border p-4 transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out ${
          isFlagged ? "cursor-default opacity-50" : disabled ? "cursor-default" : "cursor-pointer"
        } ${
          mod.enabled && !isFlagged
            ? "border-accent-500/40 bg-surface-800 shadow-[0_0_15px_-3px] shadow-accent-500/30 hover:-translate-y-px"
            : "border-surface-700 bg-surface-900 hover:-translate-y-px hover:border-surface-600 hover:bg-surface-800/80 hover:shadow-md"
        }`}
      >
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
                {mod.displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-medium text-surface-100">{mod.displayName}</h3>
            {isFlagged && (
              <Tooltip content={skinhackReason}>
                <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" />
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm text-surface-500">
              v{mod.version} • {mod.authors.join(", ") || "Unknown author"}
            </p>
            <ModPills mod={mod} max={3} />
            {isMultiLayer && <LayerBadge layers={mod.layers} />}
            <span data-no-toggle onClick={(e) => e.stopPropagation()}>
              <WadCountBadge modId={mod.id} />
            </span>
          </div>
        </div>

        <div data-no-toggle onClick={(e) => e.stopPropagation()}>
          {isMultiLayer && !mod.enabled ? (
            <LayerPickerPopover
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              modName={mod.displayName}
              layers={mod.layers}
              switchChecked={mod.enabled}
              onConfirm={handlePickerConfirm}
              onCancel={handlePickerCancel}
              disabled={disabled}
            />
          ) : (
            <Switch
              disabled={disabled}
              checked={mod.enabled}
              onCheckedChange={(checked) => handleToggle(mod.id, checked)}
            />
          )}
        </div>

        <div data-no-toggle onClick={(e) => e.stopPropagation()}>
          <Menu.Root>
            <Menu.Trigger
              disabled={patcherRunning}
              render={
                <IconButton
                  icon={<EllipsisVertical className="h-4 w-4" />}
                  variant="ghost"
                  size="md"
                  disabled={patcherRunning}
                />
              }
            />
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup>
                  {isFlagged && (
                    <Menu.Item
                      icon={<ShieldAlert className="h-4 w-4" />}
                      onClick={() => setSkinhackInfoOpen(true)}
                    >
                      What is a skinhack?
                    </Menu.Item>
                  )}
                  {!isFlagged && (
                    <Menu.Item
                      icon={<Info className="h-4 w-4" />}
                      onClick={() => onViewDetails?.(mod)}
                    >
                      View Details
                    </Menu.Item>
                  )}
                  {!isFlagged && (
                    <Menu.Item
                      icon={<Edit3 className="h-4 w-4" />}
                      onClick={() => onEditMetadata?.(mod)}
                    >
                      Edit Metadata
                    </Menu.Item>
                  )}
                  <Menu.Item icon={<FolderOpen className="h-4 w-4" />} onClick={handleOpenLocation}>
                    Open Location
                  </Menu.Item>
                  <Menu.Item icon={<Copy className="h-4 w-4" />} onClick={handleCopyId}>
                    Copy ID
                  </Menu.Item>
                  {isInUserFolder && (
                    <Menu.Item
                      icon={<FolderX className="h-4 w-4" />}
                      onClick={() =>
                        moveModToFolder.mutate({ modId: mod.id, folderId: ROOT_FOLDER_ID })
                      }
                    >
                      Remove from folder
                    </Menu.Item>
                  )}
                  <Menu.Separator />
                  <Menu.Item
                    icon={<Trash2 className="h-4 w-4" />}
                    variant="danger"
                    disabled={patcherRunning}
                    onClick={handleUninstall}
                  >
                    Uninstall
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <SkinhackInfoDialog open={skinhackInfoOpen} onOpenChange={setSkinhackInfoOpen} />
      </div>
    );
  }

  return (
    <div
      onClick={handleCardClick}
      className={`group relative flex h-full flex-col rounded-xl border transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out ${
        isFlagged ? "cursor-default opacity-50" : disabled ? "cursor-default" : "cursor-pointer"
      } ${
        mod.enabled && !isFlagged
          ? "border-accent-500/40 bg-surface-800 shadow-[0_0_20px_-5px] shadow-accent-500/40 hover:-translate-y-px hover:shadow-[0_0_20px_-3px,0_4px_6px_-1px] hover:shadow-accent-500/40"
          : "border-surface-600 bg-surface-800 hover:-translate-y-px hover:border-surface-400 hover:bg-surface-700/80 hover:shadow-md"
      }`}
    >
      <div
        className="absolute top-2 right-2 z-10"
        data-no-toggle
        onClick={(e) => e.stopPropagation()}
      >
        {isMultiLayer && !mod.enabled ? (
          <LayerPickerPopover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            modName={mod.displayName}
            layers={mod.layers}
            switchSize="sm"
            switchClassName="shadow-lg data-[unchecked]:bg-surface-600/80 data-[unchecked]:backdrop-blur-sm"
            switchChecked={mod.enabled}
            onConfirm={handlePickerConfirm}
            onCancel={handlePickerCancel}
            disabled={disabled}
          />
        ) : (
          <Switch
            size="sm"
            disabled={disabled}
            checked={mod.enabled}
            onCheckedChange={(checked) => handleToggle(mod.id, checked)}
            className="shadow-lg data-[unchecked]:bg-surface-600/80 data-[unchecked]:backdrop-blur-sm"
          />
        )}
      </div>

      {isFlagged && (
        <Tooltip content={skinhackReason}>
          <div className="absolute top-2 left-2 z-10 rounded-md bg-red-500/90 p-1">
            <ShieldAlert className="h-4 w-4 text-white" />
          </div>
        </Tooltip>
      )}

      <div className="relative aspect-video overflow-hidden rounded-t-xl bg-linear-to-br from-surface-700 to-surface-800">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-4xl font-bold text-surface-400">
              {mod.displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="mb-1 flex items-center gap-1">
          <h3 className="line-clamp-1 text-sm font-medium text-surface-100">{mod.displayName}</h3>
          {isFlagged && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-500" />}
        </div>

        <div className="mb-1 flex min-h-5 items-center gap-1">
          <ModPills mod={mod} max={3} />
          {isMultiLayer && <LayerBadge layers={mod.layers} />}
          <span data-no-toggle onClick={(e) => e.stopPropagation()}>
            <WadCountBadge modId={mod.id} />
          </span>
        </div>

        <div className="mt-auto flex items-center text-xs text-surface-500">
          <span>v{mod.version}</span>
          <span className="mx-1">•</span>
          <span className="flex-1 truncate">
            {mod.authors.length > 0 ? mod.authors[0] : "Unknown"}
          </span>
          <div className="ml-1 shrink-0" data-no-toggle onClick={(e) => e.stopPropagation()}>
            <Menu.Root>
              <Menu.Trigger
                disabled={patcherRunning}
                render={
                  <IconButton
                    icon={<EllipsisVertical className="h-4 w-4" />}
                    variant="ghost"
                    size="md"
                    disabled={patcherRunning}
                  />
                }
              />
              <Menu.Portal>
                <Menu.Positioner>
                  <Menu.Popup>
                    {isFlagged && (
                      <Menu.Item
                        icon={<ShieldAlert className="h-4 w-4" />}
                        onClick={() => setSkinhackInfoOpen(true)}
                      >
                        What is a skinhack?
                      </Menu.Item>
                    )}
                    {!isFlagged && (
                      <Menu.Item
                        icon={<Info className="h-4 w-4" />}
                        onClick={() => onViewDetails?.(mod)}
                      >
                        View Details
                      </Menu.Item>
                    )}
                    {!isFlagged && (
                      <Menu.Item
                        icon={<Edit3 className="h-4 w-4" />}
                        onClick={() => onEditMetadata?.(mod)}
                      >
                        Edit Metadata
                      </Menu.Item>
                    )}
                    <Menu.Item
                      icon={<FolderOpen className="h-4 w-4" />}
                      onClick={handleOpenLocation}
                    >
                      Open Location
                    </Menu.Item>
                    <Menu.Item icon={<Copy className="h-4 w-4" />} onClick={handleCopyId}>
                      Copy ID
                    </Menu.Item>
                    {isInUserFolder && (
                      <Menu.Item
                        icon={<FolderX className="h-4 w-4" />}
                        onClick={() =>
                          moveModToFolder.mutate({ modId: mod.id, folderId: ROOT_FOLDER_ID })
                        }
                      >
                        Remove from folder
                      </Menu.Item>
                    )}
                    <Menu.Separator />
                    <Menu.Item
                      icon={<Trash2 className="h-4 w-4" />}
                      variant="danger"
                      disabled={patcherRunning}
                      onClick={handleUninstall}
                    >
                      Uninstall
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
      </div>
      <SkinhackInfoDialog open={skinhackInfoOpen} onOpenChange={setSkinhackInfoOpen} />
    </div>
  );
}

function SkinhackInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="sm">
          <Dialog.Header>
            <Dialog.Title>What is a skinhack?</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-sm leading-relaxed text-surface-300">
              A skinhack is a mod that grants access to paid League of Legends skins.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-surface-300">
              Using skinhacks violates the distribution policy and can put your account at risk. LTK
              Manager blocks these mods to protect both users and the modding community.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-surface-400">
              If you believe this mod was flagged incorrectly, open an issue on the GitHub
              repository page with the relevant info and we will investigate.
            </p>
          </Dialog.Body>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ModPills({ mod, max, className }: { mod: InstalledMod; max: number; className?: string }) {
  const pills = [
    ...mod.tags.map((t) => ({ label: getTagLabel(t), color: "brand" as const })),
    ...mod.champions.map((c) => ({ label: c, color: "emerald" as const })),
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

function LayerBadge({ layers }: { layers: ModLayer[] }) {
  const enabledCount = layers.filter((l) => l.enabled).length;
  const allEnabled = enabledCount === layers.length;

  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-surface-700/60 px-1.5 py-0.5 text-[10px] leading-tight text-surface-400">
      <Layers className="h-2.5 w-2.5" />
      {allEnabled ? layers.length : `${enabledCount}/${layers.length}`}
    </span>
  );
}
