import Mark from "@/assets/icons/BaseLayerIcon.svg?react";

interface BaseLayerIconProps {
  className?: string;
}

export function BaseLayerIcon({ className }: BaseLayerIconProps) {
  return <Mark className={className} />;
}
