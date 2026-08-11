import {
  DownloadSimpleIcon,
  ImageIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";

import { AutoPill, Button, Dialog, FormField, MultiSelect, useToast } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import {
  getMapLabel,
  getTagLabel,
  libraryKeys,
  normKey,
  useEditMod,
  useFetchModThumbnail,
  useModEffectiveCategories,
  useModThumbnail,
  WELL_KNOWN_MAPS,
  WELL_KNOWN_TAGS,
} from "@/modules/library";

interface EditMetadataDialogProps {
  mod: InstalledMod;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditMetadataDialog({ mod, open, onOpenChange }: EditMetadataDialogProps) {
  const [displayName, setDisplayName] = useState(mod.displayName);
  const [tags, setTags] = useState<Set<string>>(new Set(mod.tags));
  const [maps, setMaps] = useState<Set<string>>(new Set(mod.maps));
  const [championsStr, setChampionsStr] = useState(mod.champions.join(", "));
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(null);
  const [removeThumbnail, setRemoveThumbnail] = useState(false);

  const editMod = useEditMod();
  const fetchThumbnail = useFetchModThumbnail(mod.id);
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: currentThumbnailUrl } = useModThumbnail(mod.id);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setDisplayName(mod.displayName);
      setTags(new Set(mod.tags));
      setMaps(new Set(mod.maps));
      setChampionsStr(mod.champions.join(", "));
      setThumbnailPath(null);
      setRemoveThumbnail(false);
    }
  }, [mod, open]);

  const tagOptions = useMemo(() => {
    const options = WELL_KNOWN_TAGS.map((tag) => ({ value: tag, label: getTagLabel(tag) }));
    // Add any custom tags the mod already has
    mod.tags.forEach((tag) => {
      if (!options.some((o) => o.value === tag)) {
        options.push({ value: tag, label: tag });
      }
    });
    return options;
  }, [mod.tags]);

  const mapOptions = useMemo(() => {
    const options = WELL_KNOWN_MAPS.map((map) => ({ value: map, label: getMapLabel(map) }));
    // Add any custom maps the mod already has
    mod.maps.forEach((map) => {
      if (!options.some((o) => o.value === map)) {
        options.push({ value: map, label: map });
      }
    });
    return options;
  }, [mod.maps]);

  const eff = useModEffectiveCategories(mod);

  const currentChampions = useMemo(
    () =>
      championsStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [championsStr],
  );

  // Footprint-derived values not already staged in the form become suggestions.
  const suggestions = useMemo(() => {
    const championKeys = new Set(currentChampions.map(normKey));
    return {
      tags: eff.derivedTags.filter((t) => !tags.has(t)),
      maps: eff.derivedMaps.filter((m) => !maps.has(m)),
      champions: eff.derivedChampions.filter((c) => !championKeys.has(normKey(c))),
    };
  }, [eff, tags, maps, currentChampions]);

  const hasSuggestions =
    suggestions.tags.length + suggestions.maps.length + suggestions.champions.length > 0;

  const addTag = (tag: string) => setTags((prev) => new Set(prev).add(tag));
  const addMap = (map: string) => setMaps((prev) => new Set(prev).add(map));
  const addChampion = (champion: string) =>
    setChampionsStr((prev) => {
      const list = prev
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.some((c) => normKey(c) === normKey(champion))) return prev;
      return [...list, champion].join(", ");
    });

  const applyAllSuggestions = () => {
    if (suggestions.tags.length > 0) {
      setTags((prev) => new Set([...prev, ...suggestions.tags]));
    }
    if (suggestions.maps.length > 0) {
      setMaps((prev) => new Set([...prev, ...suggestions.maps]));
    }
    if (suggestions.champions.length > 0) {
      setChampionsStr((prev) => {
        const list = prev
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const keys = new Set(list.map(normKey));
        const additions = suggestions.champions.filter((c) => !keys.has(normKey(c)));
        return [...list, ...additions].join(", ");
      });
    }
  };

  const handleSetThumbnail = async () => {
    const file = await openFileDialog({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["webp", "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "ico"],
        },
      ],
    });
    if (file && typeof file === "string") {
      setThumbnailPath(file);
      setRemoveThumbnail(false);
    }
  };

  const handleRemoveThumbnail = () => {
    setThumbnailPath(null);
    setRemoveThumbnail(true);
  };

  const handleFetchThumbnail = () => {
    fetchThumbnail.mutate(undefined, {
      onSuccess: (path) => {
        if (path) {
          setRemoveThumbnail(false);
          toast.success("Thumbnail found", "Artwork was downloaded from RuneForge.");
        } else {
          toast.info("No match found", "RuneForge did not return an unambiguous match.");
        }
      },
      onError: (error) => toast.error("Thumbnail lookup failed", error.message),
    });
  };

  const handleSave = () => {
    const champions = championsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    editMod.mutate(
      {
        modId: mod.id,
        metadata: {
          displayName,
          tags: Array.from(tags),
          maps: Array.from(maps),
          champions,
          setThumbnailPath: thumbnailPath,
          removeThumbnail: removeThumbnail,
        },
      },
      {
        onSuccess: () => {
          toast.success("Metadata updated", "Mod information has been saved successfully.");
          queryClient.invalidateQueries({ queryKey: libraryKeys.thumbnail(mod.id) });
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error("Failed to update metadata", error.message);
        },
      },
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="md">
          <Dialog.Header>
            <Dialog.Title className="flex items-center gap-2">
              <PencilSimpleIcon className="h-5 w-5 text-accent-500" />
              Edit Mod Metadata
            </Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="relative aspect-video w-48 shrink-0 overflow-hidden rounded-lg border border-surface-600 bg-linear-to-br from-surface-700 to-surface-800">
                {!removeThumbnail && (thumbnailPath || currentThumbnailUrl) ? (
                  <img
                    src={thumbnailPath ? convertFileSrc(thumbnailPath) : currentThumbnailUrl}
                    alt="Mod thumbnail"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-surface-500" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  left={<ImageIcon className="h-4 w-4" weight="bold" />}
                  onClick={handleSetThumbnail}
                >
                  Set Thumbnail
                </Button>
                {!removeThumbnail && !thumbnailPath && !currentThumbnailUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    left={<DownloadSimpleIcon className="h-4 w-4" weight="bold" />}
                    onClick={handleFetchThumbnail}
                    loading={fetchThumbnail.isPending}
                  >
                    Find on RuneForge
                  </Button>
                )}
                {!removeThumbnail && (thumbnailPath || currentThumbnailUrl) && (
                  <Button
                    variant="outline"
                    size="sm"
                    left={<TrashIcon className="h-4 w-4" weight="bold" />}
                    onClick={handleRemoveThumbnail}
                    className="text-red-400 hover:bg-red-400/10 hover:text-red-300"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <FormField
              label="Mod Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. My Awesome Mod"
            />

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-surface-200">Tags</label>
              <MultiSelect
                options={tagOptions}
                selected={tags}
                onChange={setTags}
                placeholder="Select tags..."
                variant="field"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-surface-200">Maps</label>
              <MultiSelect
                options={mapOptions}
                selected={maps}
                onChange={setMaps}
                placeholder="Select maps..."
                variant="field"
              />
            </div>

            <FormField
              label="Champions"
              description="Comma-separated list of champions (e.g. Ahri, Yasuo)"
              value={championsStr}
              onChange={(e) => setChampionsStr(e.target.value)}
              placeholder="e.g. Riven, Lee Sin"
            />

            {hasSuggestions && (
              <div className="space-y-2 rounded-lg border border-dashed border-surface-600 bg-surface-800/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-surface-200">
                    <SparkleIcon className="h-4 w-4 text-accent-400" />
                    Auto-detected suggestions
                  </span>
                  <Button variant="outline" size="sm" onClick={applyAllSuggestions}>
                    Apply all
                  </Button>
                </div>
                <p className="text-xs text-surface-400">
                  Detected from the game files this mod patches. Click to add, then save.
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {suggestions.tags.map((tag) => (
                    <AutoPill
                      key={`tag:${tag}`}
                      label={getTagLabel(tag)}
                      tone="accent"
                      onClick={() => addTag(tag)}
                    />
                  ))}
                  {suggestions.champions.map((champion) => (
                    <AutoPill
                      key={`champ:${champion}`}
                      label={champion}
                      tone="emerald"
                      onClick={() => addChampion(champion)}
                    />
                  ))}
                  {suggestions.maps.map((map) => (
                    <AutoPill
                      key={`map:${map}`}
                      label={getMapLabel(map)}
                      tone="sky"
                      onClick={() => addMap(map)}
                    />
                  ))}
                </div>
              </div>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={editMod.isPending}
            >
              Cancel
            </Button>
            <Button variant="filled" onClick={handleSave} disabled={editMod.isPending}>
              {editMod.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
