import Mark from "@/assets/icons/game/ThreeMasksIcon.svg?react";

interface ThreeMasksIconProps {
  className?: string;
}

/**
 * Three Demacian masks side by side - the League client's mark for a cosmetics
 * collection, where `MaskIcon` stands for a single one.
 *
 * Fills the 20x20 box edge to edge, so it sits centred where `MaskIcon` leans
 * left. The client fixes it to parchment (#F0E6D2); here it inherits text
 * color.
 */
export function ThreeMasksIcon({ className }: ThreeMasksIconProps) {
  return <Mark className={className} />;
}
