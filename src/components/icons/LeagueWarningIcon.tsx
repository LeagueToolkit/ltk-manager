import Mark from "@/assets/icons/game/LeagueWarningIcon.svg?react";

interface LeagueWarningIconProps {
  className?: string;
}

export function LeagueWarningIcon({ className }: LeagueWarningIconProps) {
  return <Mark className={className} />;
}
