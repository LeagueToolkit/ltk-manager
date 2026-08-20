import Mark from "@/assets/icons/game/RiotClassicIcon.svg?react";

interface RiotClassicIconProps {
  className?: string;
}

/**
 * The pre-2019 Riot fist - the spiked emblem with the fist knocked out.
 *
 * Riot no longer ships this one as a vector, so it is machine-traced (potrace)
 * from a clean bitmap of the mark rather than drawn by hand. The white fist of
 * the original is a hole in the path, so whatever sits behind the icon shows
 * through, and the whole mark takes `currentColor`.
 *
 * `RiotIcon` and `FistbumpIcon` are the current mark. Same fan-content caution
 * as those: keep it off anything that could read as Riot endorsing this app.
 */
export function RiotClassicIcon({ className }: RiotClassicIconProps) {
  return <Mark className={className} />;
}
