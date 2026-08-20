import Mark from "@/assets/icons/game/RitobinIcon.svg?react";

interface RitobinIconProps {
  className?: string;
}

/**
 * Riot's property bin format - `.bin` files and their ritobin text form.
 *
 * A generic file outline with `FistbumpIcon`'s fist badged over the bottom-left
 * corner, separated by a knockout channel so the overlap stays transparent on
 * any background. The page takes `currentColor` like every other file glyph,
 * and the fist keeps Riot's own red (#ff2345), which holds its value across
 * themes the way `brand-*` does - the red is the format's identity, not a
 * status.
 */
export function RitobinIcon({ className }: RitobinIconProps) {
  return <Mark className={className} />;
}
