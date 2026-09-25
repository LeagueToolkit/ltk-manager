import { mapLabel } from "../builtinMods";

interface MapTagsProps {
  /** Map archives such as `Map11.wad.client`. */
  maps: string[];
}

/** One tag per map archive, by the name players know the map by. */
export function MapTags({ maps }: MapTagsProps) {
  return (
    <span className="flex shrink-0 gap-1">
      {maps.map((map) => (
        <span
          key={map}
          className="rounded-sm bg-surface-veil px-1.5 text-fine whitespace-nowrap text-surface-300"
        >
          {mapLabel(map)}
        </span>
      ))}
    </span>
  );
}
