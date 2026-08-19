import Mark from "@/assets/icons/game/EvolutionIcon.svg?react";

interface EvolutionIconProps {
  className?: string;
}

/**
 * A Demacian mask with a double chevron rising off its shoulder - the League
 * client's mark for something that can be upgraded.
 *
 * The chevron overlaps the mask's right edge, so the mark needs its own space
 * rather than sitting flush in a tight row. The client fixes it to parchment
 * (#F0E6D2); here it inherits text color.
 */
export function EvolutionIcon({ className }: EvolutionIconProps) {
  return <Mark className={className} />;
}
