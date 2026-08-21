import { twMerge } from "tailwind-merge";

import type { Consequence } from "@/lib/tauri";

/* A consequence is a thing that happened to the game, which is what the status
   scales are for. The two that cost the player everything they asked for take
   danger, and the two that cost part of it take warning: DS-KIND-HUE. */
const COSTS: Record<Consequence, { label: string; className: string }> = {
  "overlay-off": {
    label: "No mod ran",
    className: "border-danger/40 bg-danger/10 text-danger-text",
  },
  "game-stopped": {
    label: "Game stopped",
    className: "border-danger/40 bg-danger/10 text-danger-text",
  },
  "game-hung": {
    label: "Game hung",
    className: "border-warning/40 bg-warning/10 text-warning-text",
  },
  "archive-dropped": {
    label: "Archive dropped",
    className: "border-warning/40 bg-warning/10 text-warning-text",
  },
};

interface ConsequenceChipProps {
  consequence: Consequence;
  className?: string;
}

/** What the game lost, in the band of how much of it was lost. */
export function ConsequenceChip({ consequence, className }: ConsequenceChipProps) {
  const cost = COSTS[consequence];
  return (
    <span
      data-ui="ConsequenceChip"
      className={twMerge(
        "inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase select-none",
        cost.className,
        className,
      )}
    >
      {cost.label}
    </span>
  );
}
