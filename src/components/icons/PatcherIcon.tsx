import Mark from "@/assets/icons/PatcherIcon.svg?react";

interface PatcherIconProps {
  className?: string;
}

export function PatcherIcon({ className }: PatcherIconProps) {
  return <Mark className={className} />;
}
