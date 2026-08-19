import Mark from "@/assets/icons/game/CollectionIcon.svg?react";

interface CollectionIconProps {
  className?: string;
}

/**
 * An open chest - the League client's mark for the Collection tab.
 *
 * The artwork is 26x24 rather than square, which is the shape the client draws.
 * The viewBox keeps it, so a call site sizing by width gets the mark's own
 * proportions instead of a stretched one.
 */
export function CollectionIcon({ className }: CollectionIconProps) {
  return <Mark className={className} />;
}
