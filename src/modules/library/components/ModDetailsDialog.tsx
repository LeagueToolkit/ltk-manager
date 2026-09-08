import { PackageIcon } from "@phosphor-icons/react";
import { Calendar, FolderOpen, Layers, Map, Sword, Tag, User } from "lucide-react";

import { Button, Dialog } from "@/components";
import { type InstalledMod, revealPath } from "@/lib/tauri";
import { useModChecksumMismatches, useSetModLayers } from "@/modules/library/api";
import { useModThumbnail } from "@/modules/library/api/useModThumbnail";
import { getMapLabel, getTagLabel } from "@/modules/library/utils/labels";

import { LayerToggleList } from "./LayerToggleList";

interface ModDetailsDialogProps {
  open: boolean;
  mod: InstalledMod | null;
  onClose: () => void;
}

export function ModDetailsDialog({ open, mod, onClose }: ModDetailsDialogProps) {
  if (!mod) return null;

  return (
    <Dialog.Shell open={open} onClose={onClose} title={mod.displayName} size="md">
      <Dialog.Body className="space-y-5">
        <ModDetailsContent mod={mod} />
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="filled"
          left={<FolderOpen className="h-4 w-4" />}
          onClick={() => revealPath(mod.modDir)}
        >
          Open Location
        </Button>
      </Dialog.Footer>
    </Dialog.Shell>
  );
}

function ModDetailsContent({ mod }: { mod: InstalledMod }) {
  const { data: thumbnailUrl } = useModThumbnail(mod.id);

  const installedDate = new Date(mod.installedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      {/* Thumbnail + basic info */}
      <div className="flex gap-4">
        <div className="relative h-20 w-[8.75rem] shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-surface-700 to-surface-800">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-2xl font-bold text-surface-500">
                {mod.displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm text-surface-400">v{mod.version}</p>
          <div className="flex items-center gap-1.5 text-sm text-surface-400">
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{mod.authors.join(", ") || "Unknown author"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-surface-400">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span>Installed {installedDate}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      {mod.description && (
        <div>
          <h4 className="mb-1 text-xs font-medium tracking-wide text-surface-500 uppercase">
            Description
          </h4>
          <p className="text-sm leading-relaxed text-surface-300">{mod.description}</p>
        </div>
      )}

      {/* Tags */}
      {mod.tags.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-surface-500 uppercase">
            <Tag className="h-3.5 w-3.5" />
            Tags
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {mod.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-accent-500/15 px-2.5 py-0.5 text-xs text-accent-300"
              >
                {getTagLabel(tag)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Champions */}
      {mod.champions.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-surface-500 uppercase">
            <Sword className="h-3.5 w-3.5" />
            Champions
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {mod.champions.map((champ) => (
              <span
                key={champ}
                className="rounded-full bg-cat-champion/15 px-2.5 py-0.5 text-xs text-cat-champion-text"
              >
                {champ}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Maps */}
      {mod.maps.length > 0 && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-surface-500 uppercase">
            <Map className="h-3.5 w-3.5" />
            Maps
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {mod.maps.map((map) => (
              <span
                key={map}
                className="rounded-full bg-cat-map/15 px-2.5 py-0.5 text-xs text-cat-map-text"
              >
                {getMapLabel(map)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Layers */}
      {mod.layers.length > 1 && <ModDetailsLayers mod={mod} />}

      <ModDetailsPackaging modId={mod.id} />

      {/* File path */}
      <div>
        <h4 className="mb-1 text-xs font-medium tracking-wide text-surface-500 uppercase">
          Location
        </h4>
        <p className="text-xs break-all text-surface-400">{mod.modDir}</p>
      </div>
    </>
  );
}

/**
 * Advisory about a badly-packed archive: the last overlay build found chunks
 * whose container claimed checksums their own bytes don't have. Never blocks
 * anything — the build carries the corrected values — so this renders nothing
 * for a mod whose containers told the truth.
 */
function ModDetailsPackaging({ modId }: { modId: string }) {
  const { data: mismatches } = useModChecksumMismatches(modId);
  if (!mismatches || mismatches.length === 0) return null;

  // Plain record: lucide's Map icon import shadows the global Map here.
  const byWad: Record<string, number> = {};
  for (const mismatch of mismatches) {
    byWad[mismatch.wadName] = (byWad[mismatch.wadName] ?? 0) + 1;
  }

  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-surface-500 uppercase">
        <PackageIcon className="h-3.5 w-3.5 text-warning-text" />
        Packaging
      </h4>
      <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
        <p className="text-xs leading-relaxed text-surface-300">
          This mod&apos;s archive reports checksums its own files don&apos;t have. The mod still
          works — the manager corrects them while building — but the tool that packed it wrote wrong
          metadata, so it&apos;s worth re-exporting.
        </p>
        <ul className="flex flex-col gap-0.5">
          {Object.entries(byWad).map(([wadName, count]) => (
            <li key={wadName} className="flex items-baseline gap-2 text-xs text-surface-400">
              <span className="font-mono text-code break-all">{wadName}</span>
              <span className="shrink-0">
                {count} chunk{count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ModDetailsLayers({ mod }: { mod: InstalledMod }) {
  const setModLayers = useSetModLayers();

  function handleToggle(layerName: string, enabled: boolean) {
    const layerStates: Record<string, boolean> = {};
    for (const layer of mod.layers) {
      layerStates[layer.name] = layer.name === layerName ? enabled : layer.enabled;
    }
    setModLayers.mutate({ modId: mod.id, layerStates });
  }

  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-surface-500 uppercase">
        <Layers className="h-3.5 w-3.5" />
        Layers ({mod.layers.filter((l) => l.enabled).length}/{mod.layers.length})
      </h4>
      <LayerToggleList layers={mod.layers} onToggle={handleToggle} />
    </div>
  );
}
