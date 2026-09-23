import Mark from "@/assets/icons/game/HexshadeIcon.svg?react";

interface HexshadeIconProps {
  className?: string;
}

/**
 * The Ancient Spark orb, the mark for Hexshade, the viewport's shader pipeline.
 *
 * The violet-to-cyan gradient is the mark's identity, so it keeps its colors
 * in both themes rather than taking `currentColor`.
 */
export function HexshadeIcon({ className }: HexshadeIconProps) {
  return <Mark className={className} />;
}
