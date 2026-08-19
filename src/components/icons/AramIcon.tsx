import Mark from "@/assets/icons/game/AramIcon.svg?react";

interface AramIconProps {
  className?: string;
}

export function AramIcon({ className }: AramIconProps) {
  return <Mark className={className} />;
}
