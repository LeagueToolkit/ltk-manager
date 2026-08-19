import Mark from "@/assets/icons/game/SummonersRiftIcon.svg?react";

interface SummonersRiftIconProps {
  className?: string;
}

export function SummonersRiftIcon({ className }: SummonersRiftIconProps) {
  return <Mark className={className} />;
}
