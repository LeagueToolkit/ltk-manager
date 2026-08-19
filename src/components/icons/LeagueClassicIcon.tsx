import Mark from "@/assets/icons/game/LeagueClassicIcon.svg?react";

interface LeagueClassicIconProps {
  className?: string;
}

export function LeagueClassicIcon({ className }: LeagueClassicIconProps) {
  return <Mark className={className} />;
}
