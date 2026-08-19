import Mark from "@/assets/icons/game/RecallIcon.svg?react";

interface RecallIconProps {
  className?: string;
}

export function RecallIcon({ className }: RecallIconProps) {
  return <Mark className={className} />;
}
