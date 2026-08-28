import Mark from "@/assets/icons/WolfIcon.svg?react";

interface WolfIconProps {
  className?: string;
}

/**
 * A murk wolf in its own three-tone amber, drawn as a candidate app mark.
 *
 * A mark keeps its palette instead of inheriting `currentColor`: DS-INVARIANT.
 * Its amber is the warning tone's, so it only belongs on a surface in that tone.
 */
export function WolfIcon({ className }: WolfIconProps) {
  return <Mark className={className} />;
}
