import Mark from "@/assets/icons/game/MaskIcon.svg?react";

interface MaskIconProps {
  className?: string;
}

/**
 * A Demacian mask with a second one behind it - the League client's own mark
 * for cosmetics.
 *
 * The client fixes it to parchment (#F0E6D2); here it inherits text color.
 *
 * The viewBox is cropped to the artwork rather than kept at the client's 0 0 20
 * 20, where the mark fills barely half the height and reads a size smaller than
 * the lucide icons around it.
 */
export function MaskIcon({ className }: MaskIconProps) {
  return <Mark className={className} />;
}
