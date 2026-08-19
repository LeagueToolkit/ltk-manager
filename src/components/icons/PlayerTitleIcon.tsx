import Mark from "@/assets/icons/game/PlayerTitleIcon.svg?react";

interface PlayerTitleIconProps {
  className?: string;
}

/** A quill over a banner - the League client's mark for a player's title. */
export function PlayerTitleIcon({ className }: PlayerTitleIconProps) {
  return <Mark className={className} />;
}
