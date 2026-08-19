import Mark from "@/assets/icons/game/BattleBoostIcon.svg?react";

interface BattleBoostIconProps {
  className?: string;
}

/**
 * A Demacian mask with an arrow rising off its lower right - the League
 * client's mark for a battle boost.
 *
 * The counterpart to `EvolutionIcon`, whose chevron sits in the opposite
 * corner. Riot cuts the mask's corner away on a straight diagonal to seat the
 * arrow, so the two shapes need no separator of their own. The client fixes it
 * to gold (#CDBE91); here it inherits text color.
 *
 * The viewBox is cropped from the client's 0 0 36 36, where the mark fills half
 * the box, and framed so the mask reads at Evolution's height beside it.
 */
export function BattleBoostIcon({ className }: BattleBoostIconProps) {
  return <Mark className={className} />;
}
