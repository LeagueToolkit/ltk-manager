import Mark from "@/assets/icons/game/TftIcon.svg?react";

interface TftIconProps {
  className?: string;
}

/**
 * The Teamfight Tactics mark - a T over a coiled tail.
 *
 * The client fixes it to parchment (#F0E6D2); here it inherits text color.
 */
export function TftIcon({ className }: TftIconProps) {
  return <Mark className={className} />;
}
