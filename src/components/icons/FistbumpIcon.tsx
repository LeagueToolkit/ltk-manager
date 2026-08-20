import Mark from "@/assets/icons/game/FistbumpIcon.svg?react";

interface FistbumpIconProps {
  className?: string;
}

/**
 * The Riot fist as the fist bump tracker draws it.
 *
 * The same corporate mark as `RiotIcon`, from a different client asset. This
 * tracing is cut for tiny sizes - it fills its 20x20 box edge to edge where the
 * client pads `RiotIcon`'s - so reach for it where the fist is a badge on
 * something else, and for `RiotIcon` where it stands alone.
 *
 * Riot's fan-content policy is narrower for the corporate mark than for game
 * art: keep it off anything that could read as Riot endorsing this app.
 */
export function FistbumpIcon({ className }: FistbumpIconProps) {
  return <Mark className={className} />;
}
