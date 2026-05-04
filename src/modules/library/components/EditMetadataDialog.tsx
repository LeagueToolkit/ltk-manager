import { Edit3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button, Dialog, FormField, MultiSelect, useToast } from "@/components";
import type { InstalledMod } from "@/lib/tauri";
import { useEditMod } from "@/modules/library/api/useEditMod";
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

  const editMod = useEditMod();
  const toast = useToast();

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setDisplayName(mod.displayName);
      setTags(new Set(mod.tags));
      setMaps(new Set(mod.maps));
      setChampionsStr(mod.champions.join(", "));
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
        },
      },
      {
        onSuccess: () => {
          toast.success("Metadata updated", "Mod information has been saved successfully.");
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
