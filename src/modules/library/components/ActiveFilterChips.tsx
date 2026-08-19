import { XIcon } from "@phosphor-icons/react";

import { getMapLabel, getTagLabel } from "@/modules/library/utils/labels";
import { useHasActiveFilters, useLibraryFilterStore } from "@/stores";

export function ActiveFilterChips() {
  const {
    selectedTags,
    selectedChampions,
    selectedMaps,
    toggleTag,
    toggleChampion,
    toggleMap,
    clearFilters,
  } = useLibraryFilterStore();
  const hasActive = useHasActiveFilters();

  if (!hasActive) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      {[...selectedTags].map((tag) => (
        <Chip
          key={`tag:${tag}`}
          label={getTagLabel(tag)}
          color="tag"
          onRemove={() => toggleTag(tag)}
        />
      ))}
      {[...selectedChampions].map((champ) => (
        <Chip
          key={`champ:${champ}`}
          label={champ}
          color="champion"
          onRemove={() => toggleChampion(champ)}
        />
      ))}
      {[...selectedMaps].map((map) => (
        <Chip
          key={`map:${map}`}
          label={getMapLabel(map)}
          color="map"
          onRemove={() => toggleMap(map)}
        />
      ))}
      <button
        onClick={clearFilters}
        className="cursor-pointer text-xs text-surface-400 hover:text-surface-200"
      >
        Clear all
      </button>
    </div>
  );
}

// Same categorical hues as the library's ModPills.
const COLOR_CLASSES = {
  tag: "bg-accent-500/15 text-accent-300 border-accent-500/30",
  champion: "bg-cat-champion/15 text-cat-champion-text border-cat-champion/30",
  map: "bg-cat-map/15 text-cat-map-text border-cat-map/30",
} as const;

function Chip({
  label,
  color,
  onRemove,
}: {
  label: string;
  color: keyof typeof COLOR_CLASSES;
  onRemove: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${COLOR_CLASSES[color]}`}
    >
      {label}
      <button
        onClick={onRemove}
        className="cursor-pointer rounded-full p-0.5 hover:bg-surface-50/10"
      >
        <XIcon weight="bold" className="h-3 w-3" />
      </button>
    </span>
  );
}
