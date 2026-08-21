import Mark from "@/assets/icons/game/HextechDrakeDuotoneIcon.svg?react";

interface HextechDrakeDuotoneIconProps {
  className?: string;
}

/**
 * The hextech drake rune, as bright linework over a dimmed diamond.
 *
 * The game asset is two colors - black frame, blue bands. A hardcoded second
 * color would break under theme and tint changes, so the frame is a layer of
 * the same `currentColor` at 30% opacity. The two layers are cut from each
 * other rather than stacked, so the mark stays flat when a caller fades the
 * whole glyph.
 */
export function HextechDrakeDuotoneIcon({ className }: HextechDrakeDuotoneIconProps) {
  return <Mark className={className} />;
}
