import { useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Edit3, Image, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button, Dialog, FormField, MultiSelect, useToast } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import { libraryKeys } from "@/modules/library/api/keys";
import { useEditMod } from "@/modules/library/api/useEditMod";
import { useModThumbnail } from "@/modules/library/api/useModThumbnail";
import {
  getMapLabel,
  getTagLabel,
  WELL_KNOWN_MAPS,
  WELL_KNOWN_TAGS,
} from "@/modules/library/utils/labels";

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
              <Edit3 className="h-5 w-5 text-accent-500" />
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
                    <Image className="h-8 w-8 text-surface-500" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  left={<Image className="h-4 w-4" />}
                  onClick={handleSetThumbnail}
                >
                  Set Thumbnail
                </Button>
                {!removeThumbnail && (thumbnailPath || currentThumbnailUrl) && (
                  <Button
                    variant="outline"
                    size="sm"
                    left={<Trash2 className="h-4 w-4" />}
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
