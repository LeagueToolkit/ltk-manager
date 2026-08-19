import Mark from "@/assets/icons/game/ChampionCheckIcon.svg?react";

interface ChampionCheckIconProps {
  className?: string;
}

/**
 * Three Demacian helms under a checkmark - the League client's mark for
 * champions already owned.
 *
 * Built the same way as `MaskCheckIcon`, and from the same bitmap set: the
 * helms are `ChampionIcon`'s own geometry placed three times, the check is
 * drawn fresh, and a knockout stands in for the bitmap's dark outline so the
 * channel between shapes stays transparent on any background.
 */
export function ChampionCheckIcon({ className }: ChampionCheckIconProps) {
  return <Mark className={className} />;
}
