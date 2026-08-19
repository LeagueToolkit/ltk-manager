import Mark from "@/assets/icons/game/RiotIcon.svg?react";

interface RiotIconProps {
  className?: string;
}

/**
 * The Riot Games fist, as the Riot Client draws it.
 *
 * Riot ships two files that differ only in fill - parchment (#F0E6D2) and red
 * (#ff2345) - so this one takes `currentColor` and the call site picks.
 *
 * Riot's own corporate mark rather than game art. Their fan-content policy is
 * narrower here: keep it off anything that could read as Riot endorsing this
 * app, and prefer `LeagueIcon` wherever the point is the game.
 */
export function RiotIcon({ className }: RiotIconProps) {
  return <Mark className={className} />;
}
