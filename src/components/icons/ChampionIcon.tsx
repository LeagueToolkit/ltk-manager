import Mark from "@/assets/icons/game/ChampionIcon.svg?react";

interface ChampionIconProps {
  className?: string;
}

export function ChampionIcon({ className }: ChampionIconProps) {
  return <Mark className={className} />;
}
