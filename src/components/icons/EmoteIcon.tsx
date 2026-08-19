import Mark from "@/assets/icons/game/EmoteIcon.svg?react";

interface EmoteIconProps {
  className?: string;
}

export function EmoteIcon({ className }: EmoteIconProps) {
  return <Mark className={className} />;
}
