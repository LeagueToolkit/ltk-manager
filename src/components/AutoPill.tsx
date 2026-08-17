import { Sparkles } from "lucide-react";
import { twMerge } from "tailwind-merge";

/** What the pill labels. The hue is the category, so the tone is named for it. */
export type AutoPillTone = "tag" | "champion" | "map";

const TONE_CLASSES: Record<AutoPillTone, string> = {
  tag: "border-accent-400/60 bg-accent-500/10 text-accent-300",
  champion: "border-cat-champion/60 bg-cat-champion/10 text-cat-champion-text",
  map: "border-cat-map/60 bg-cat-map/10 text-cat-map-text",
};

interface AutoPillProps {
  label: string;
  tone?: AutoPillTone;
  /** When provided, the pill renders as a button (an actionable suggestion). */
  onClick?: () => void;
  className?: string;
}

/**
 * A dashed-outline pill marking an auto-detected (WAD-footprint-derived)
 * category. Static for display. Pass `onClick` to use it as a clickable
 * suggestion chip.
 */
export function AutoPill({ label, tone = "tag", onClick, className }: AutoPillProps) {
  const classes = twMerge(
    "inline-flex items-center gap-0.5 rounded-md border border-dashed px-1.5 py-0.5 text-[10px] leading-tight",
    TONE_CLASSES[tone],
    onClick && "cursor-pointer transition-colors hover:bg-surface-700/40",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        <Sparkles className="h-2.5 w-2.5" />
        {label}
      </button>
    );
  }

  return (
    <span className={classes}>
      <Sparkles className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
