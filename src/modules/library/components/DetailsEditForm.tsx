import { ImageIcon, SparkleIcon, TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";

import {
  AutoPill,
  Button,
  FormField,
  IconButton,
  MultiSelect,
  useConfirm,
  useToast,
} from "@/components";
import { m } from "@/i18n";
import type { InstalledMod } from "@/lib/tauri";
import { ChampionPicker, ChampionPortrait, useChampionRoster } from "@/modules/champions";
import { libraryKeys, useEditMod, useModEffectiveCategories } from "@/modules/library/api";
import { useModThumbnail } from "@/modules/library/api/useModThumbnail";
import { useLibrarySidebarStore } from "@/modules/library/state";
import {
  getMapLabel,
  getTagLabel,
  WELL_KNOWN_MAPS,
  WELL_KNOWN_TAGS,
} from "@/modules/library/utils/labels";

import { DetailsCover } from "./DetailsCover";

/** The image formats a thumbnail may be picked from. */
const IMAGE_EXTENSIONS = ["webp", "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "ico"];

interface DetailsEditFormProps {
  mod: InstalledMod;
  /** Leave the form, whether the edit was saved or abandoned. */
  onDone: () => void;
}

/**
 * A mod's metadata, edited where it is read rather than over it.
 *
 * The panel is not modal, so the guard against losing a half-typed name is the
 * sidebar store's rather than a backdrop's: every way out of the form asks
 * first. Nothing autosaves.
 */
export function DetailsEditForm({ mod, onDone }: DetailsEditFormProps) {
  const [displayName, setDisplayName] = useState(mod.displayName);
  const [tags, setTags] = useState<Set<string>>(new Set(mod.tags));
  const [maps, setMaps] = useState<Set<string>>(new Set(mod.maps));
  const [champions, setChampions] = useState<string[]>(mod.champions);
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(null);
  const [removeThumbnail, setRemoveThumbnail] = useState(false);

  const editMod = useEditMod();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roster = useChampionRoster();
  const { data: currentThumbnailUrl } = useModThumbnail(mod.id);

  const dirty =
    displayName !== mod.displayName ||
    !sameMembers(tags, mod.tags) ||
    !sameMembers(maps, mod.maps) ||
    !sameOrder(champions, mod.champions) ||
    thumbnailPath !== null ||
    removeThumbnail;

  useUnsavedGuard(dirty);

  const tagOptions = useMemo(() => optionsFor(WELL_KNOWN_TAGS, mod.tags, getTagLabel), [mod.tags]);
  const mapOptions = useMemo(() => optionsFor(WELL_KNOWN_MAPS, mod.maps, getMapLabel), [mod.maps]);

  const derived = useModEffectiveCategories(mod);

  // Footprint-derived values not already staged in the form become suggestions.
  const suggestions = useMemo(() => {
    const championKeys = new Set(champions.map(roster.keyOf));
    return {
      tags: derived.derivedTags.filter((tag) => !tags.has(tag)),
      maps: derived.derivedMaps.filter((map) => !maps.has(map)),
      champions: derived.derivedChampions.filter(
        (champion) => !championKeys.has(roster.keyOf(champion)),
      ),
    };
  }, [derived, tags, maps, champions, roster]);

  const hasSuggestions =
    suggestions.tags.length + suggestions.maps.length + suggestions.champions.length > 0;

  const addTag = (tag: string) => setTags((prev) => new Set(prev).add(tag));
  const addMap = (map: string) => setMaps((prev) => new Set(prev).add(map));
  const addChampion = (champion: string) => setChampions((prev) => [...prev, champion]);

  function applyAllSuggestions() {
    if (suggestions.tags.length > 0) setTags((prev) => new Set([...prev, ...suggestions.tags]));
    if (suggestions.maps.length > 0) setMaps((prev) => new Set([...prev, ...suggestions.maps]));
    if (suggestions.champions.length > 0) {
      setChampions((prev) => [...prev, ...suggestions.champions]);
    }
  }

  async function handleSetThumbnail() {
    const file = await openFileDialog({
      multiple: false,
      filters: [{ name: m.library_details_thumbnail_filter_label(), extensions: IMAGE_EXTENSIONS }],
    });
    if (typeof file !== "string") return;
    setThumbnailPath(file);
    setRemoveThumbnail(false);
  }

  function handleSave() {
    editMod.mutate(
      {
        modId: mod.id,
        metadata: {
          displayName,
          tags: Array.from(tags),
          maps: Array.from(maps),
          champions,
          setThumbnailPath: thumbnailPath,
          removeThumbnail,
        },
      },
      {
        onSuccess: () => {
          toast.success(m.library_details_saved_title(), m.library_details_saved_hint());
          queryClient.invalidateQueries({ queryKey: libraryKeys.thumbnail(mod.id) });
          onDone();
        },
        onError: (error) => toast.failure(m.library_details_save_failed_title(), error),
      },
    );
  }

  const staged = stagedThumbnail(thumbnailPath, currentThumbnailUrl, removeThumbnail);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-ui="DetailsEditForm" className="min-h-0 flex-1 overflow-y-auto scrollbar-md">
        <DetailsCover mod={{ ...mod, displayName }} thumbnailUrl={staged}>
          {/* DS-INVARIANT: a control over cover art takes the scrim and `brand-on`. */}
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-scrim p-0.5 backdrop-blur-sm">
            <IconButton
              size="md"
              icon={<ImageIcon />}
              onClick={handleSetThumbnail}
              className="text-brand-on"
              label={m.library_details_thumbnail_set_action()}
            />
            {staged && (
              <IconButton
                size="md"
                icon={<TrashIcon />}
                onClick={() => {
                  setThumbnailPath(null);
                  setRemoveThumbnail(true);
                }}
                className="text-brand-on"
                label={m.library_details_thumbnail_remove_action()}
              />
            )}
          </div>
        </DetailsCover>

        <div className="flex flex-col gap-4 px-3 py-3">
          <FormField
            label={m.library_details_name_label()}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={m.library_details_name_placeholder()}
          />

          <Labelled label={m.library_details_tags_label()}>
            <MultiSelect
              options={tagOptions}
              selected={tags}
              onChange={setTags}
              placeholder={m.library_details_tags_placeholder()}
              variant="field"
            />
          </Labelled>

          <Labelled label={m.library_details_maps_label()}>
            <MultiSelect
              options={mapOptions}
              selected={maps}
              onChange={setMaps}
              placeholder={m.library_details_maps_placeholder()}
              variant="field"
            />
          </Labelled>

          <Labelled label={m.library_details_champions_label()}>
            <ChampionPicker
              value={champions}
              onChange={setChampions}
              aria-label={m.library_details_champions_label()}
            />
          </Labelled>

          {hasSuggestions && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-surface-600 bg-surface-800/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-row font-medium text-surface-200 select-none">
                  <SparkleIcon className="size-4 text-accent-400" />
                  {m.library_details_suggestions_label()}
                </span>
                <Button variant="outline" onClick={applyAllSuggestions}>
                  {m.library_details_suggestions_apply_action()}
                </Button>
              </div>
              <p className="text-meta text-surface-400 select-none">
                {m.library_details_suggestions_description()}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {suggestions.tags.map((tag) => (
                  <AutoPill
                    key={`tag:${tag}`}
                    label={getTagLabel(tag)}
                    tone="tag"
                    onClick={() => addTag(tag)}
                  />
                ))}
                {suggestions.champions.map((champion) => (
                  <AutoPill
                    key={`champion:${champion}`}
                    label={roster.labelOf(champion)}
                    tone="champion"
                    icon={
                      <ChampionPortrait
                        champion={roster.find(champion)}
                        className="mr-0.5 size-3"
                      />
                    }
                    onClick={() => addChampion(champion)}
                  />
                ))}
                {suggestions.maps.map((map) => (
                  <AutoPill
                    key={`map:${map}`}
                    label={getMapLabel(map)}
                    tone="map"
                    onClick={() => addMap(map)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DS-REPORT-PANEL's confirm band, at the list's own padding. */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-surface-700 px-3 py-2.5">
        <Button variant="ghost" onClick={onDone} disabled={editMod.isPending}>
          {m.library_details_cancel_action()}
        </Button>
        <Button variant="filled" loading={editMod.isPending} onClick={handleSave}>
          {m.library_details_save_action()}
        </Button>
      </div>
    </div>
  );
}

/**
 * Hold back every way out of the form while it has edits, and ask once.
 *
 * The store is what the cards, the tab strip and the close button all reach, so
 * it is where a press is caught. Answering it resolves the view the reader
 * asked for, or drops it and leaves the panel where it was.
 */
function useUnsavedGuard(dirty: boolean) {
  const setDirty = useLibrarySidebarStore((s) => s.setDirty);
  const pending = useLibrarySidebarStore((s) => s.pending);
  const resolvePending = useLibrarySidebarStore((s) => s.resolvePending);
  const confirm = useConfirm();

  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  useEffect(() => {
    if (!pending) return;

    let live = true;
    void confirm({
      title: m.library_details_discard_title(),
      heading: m.library_details_discard_heading(),
      description: m.library_details_discard_description(),
      confirmLabel: m.library_details_discard_action(),
    }).then((discard) => {
      if (live) resolvePending(discard);
    });

    return () => {
      live = false;
    };
  }, [pending, confirm, resolvePending]);
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-row font-medium text-surface-200 select-none">{label}</label>
      {children}
    </div>
  );
}

/** The picked file, the mod's own art, or none once the reader has cleared it. */
function stagedThumbnail(
  picked: string | null,
  current: string | undefined,
  removed: boolean,
): string | undefined {
  if (picked) return convertFileSrc(picked);
  if (removed) return undefined;
  return current;
}

/** The well-known values, plus whatever else this mod already carries. */
function optionsFor(wellKnown: string[], own: string[], label: (value: string) => string) {
  const options = wellKnown.map((value) => ({ value, label: label(value) }));
  for (const value of own) {
    if (!options.some((option) => option.value === value)) options.push({ value, label: value });
  }
  return options;
}

function sameMembers(staged: Set<string>, saved: string[]): boolean {
  return staged.size === saved.length && saved.every((value) => staged.has(value));
}

function sameOrder(staged: string[], saved: string[]): boolean {
  return staged.length === saved.length && saved.every((value, index) => staged[index] === value);
}
