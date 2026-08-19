import Mark from "@/assets/icons/game/WardIcon.svg?react";

interface WardIconProps {
  className?: string;
}

export function WardIcon({ className }: WardIconProps) {
  return <Mark className={className} />;
}
