import Mark from "@/assets/icons/game/LeagueIcon.svg?react";

interface LeagueIconProps {
  className?: string;
}

/**
 * The League of Legends "L" mark, as the Riot Client draws it.
 *
 * Riot ships it at a fixed gold (#C89B3C) behind 80% opacity; both are dropped
 * here so it inherits text color and sits at the same weight as the lucide
 * icons it shares a menu with.
 */
export function LeagueIcon({ className }: LeagueIconProps) {
  return <Mark className={className} />;
}
