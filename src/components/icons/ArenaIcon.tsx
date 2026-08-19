import Mark from "@/assets/icons/game/ArenaIcon.svg?react";

interface ArenaIconProps {
  className?: string;
}

export function ArenaIcon({ className }: ArenaIconProps) {
  return <Mark className={className} />;
}
