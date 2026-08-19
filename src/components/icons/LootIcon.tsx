import Mark from "@/assets/icons/game/LootIcon.svg?react";

interface LootIconProps {
  className?: string;
}

export function LootIcon({ className }: LootIconProps) {
  return <Mark className={className} />;
}
