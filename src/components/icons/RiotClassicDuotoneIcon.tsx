import Mark from "@/assets/icons/game/RiotClassicDuotoneIcon.svg?react";

interface RiotClassicDuotoneIconProps {
  className?: string;
}

/**
 * `RiotClassicIcon` with the fist filled back in as a second tone.
 *
 * The original is two colors - dark emblem, light fist. A hardcoded second
 * color would break under theme and tint changes, so the fist is a layer of
 * the same `currentColor` at 30% opacity over the knockout. The knuckle slits
 * belong to the emblem layer and stay solid, which keeps the fist legible at
 * 16px. Reach for `RiotClassicIcon` where the ground showing through is the
 * better reading.
 */
export function RiotClassicDuotoneIcon({ className }: RiotClassicDuotoneIconProps) {
  return <Mark className={className} />;
}
