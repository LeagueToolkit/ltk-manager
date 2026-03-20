import { X } from "lucide-react";

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
    <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
      {[...selectedTags].map((tag) => (
        <Chip
          key={`tag:${tag}`}
          label={getTagLabel(tag)}
          color="brand"
          onRemove={() => toggleTag(tag)}
        />
      ))}
      {[...selectedChampions].map((champ) => (
        <Chip
          key={`champ:${champ}`}
          label={champ}
          color="emerald"
          onRemove={() => toggleChampion(champ)}
        />
      ))}
      {[...selectedMaps].map((map) => (
        <Chip
          key={`map:${map}`}
          label={getMapLabel(map)}
          color="sky"
          onRemove={() => toggleMap(map)}
        />
      ))}
      <button onClick={clearFilters} className="text-xs text-surface-400 hover:text-surface-200">
        Clear all
      </button>
    </div>
  );
}

const COLOR_CLASSES = {
  brand: "bg-accent-500/15 text-accent-300 border-accent-500/30",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  sky: "bg-sky-500/15 text-sky-300 border-sky-500/30",
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
      <button onClick={onRemove} className="rounded-full p-0.5 hover:bg-white/10">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
