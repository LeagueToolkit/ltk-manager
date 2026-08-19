import Mark from "@/assets/icons/LayerIcon.svg?react";

interface LayerIconProps {
  className?: string;
}

export function LayerIcon({ className }: LayerIconProps) {
  return <Mark className={className} />;
}
