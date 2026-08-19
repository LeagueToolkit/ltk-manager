import Mark from "@/assets/icons/game/MaskCheckIcon.svg?react";

interface MaskCheckIconProps {
  className?: string;
}

/**
 * Two Demacian masks under a checkmark - the League client's mark for skins
 * already owned.
 *
 * The client ships this one as a 29x26 bitmap rather than a path, so the masks
 * are `MaskIcon`'s own geometry placed twice and the check is drawn fresh.
 * Tracing the bitmap would only have produced a worse copy of a mark the icon
 * set already holds.
 *
 * The bitmap separates the overlaps with a dark outline, which cannot survive a
 * single-color mark on an unknown background. A knockout takes its place, so
 * the channel between shapes is transparent whatever sits behind the icon.
 */
export function MaskCheckIcon({ className }: MaskCheckIconProps) {
  return <Mark className={className} />;
}
