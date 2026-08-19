import Mark from "@/assets/icons/game/SkinIcon.svg?react";

interface SkinIconProps {
  className?: string;
}

export function SkinIcon({ className }: SkinIconProps) {
  return <Mark className={className} />;
}
