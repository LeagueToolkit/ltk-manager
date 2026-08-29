import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/** What the pill labels. The hue is the category, so the tone is named for it. */
export type AutoPillTone = "tag" | "champion" | "map";

const TONE_CLASSES: Record<AutoPillTone, string> = {
  /* Neutral, because a plain tag names no kind: DS-KIND-HUE. */
  tag: "border-surface-400/50 bg-surface-500/10 text-surface-300",
  champion: "border-cat-champion/60 bg-cat-champion/10 text-cat-champion-text",
  map: "border-cat-map/60 bg-cat-map/10 text-cat-map-text",
};

interface AutoPillProps {
  label: string;
  tone?: AutoPillTone;
  /**
   * Replaces the sparkle, for a pill whose kind is worth a mark of its own.
   *
   * The dashed outline and the tooltip already say auto-detected, so the slot is
   * better spent naming what the pill is than repeating how it was found.
   */
  icon?: ReactNode;
  /** What the pill reads as, for one whose icon carries half the meaning. */
  ariaLabel?: string;
  /** When provided, the pill renders as a button (an actionable suggestion). */
  onClick?: () => void;
  className?: string;
}

/**
 * A dashed-outline pill marking an auto-detected (WAD-footprint-derived)
 * category. Static for display. Pass `onClick` to use it as a clickable
 * suggestion chip.
 */
export function AutoPill({
  label,
  tone = "tag",
  icon,
  ariaLabel,
  onClick,
  className,
}: AutoPillProps) {
  const mark = icon ?? <Sparkles className="h-2.5 w-2.5" />;

  const classes = twMerge(
    "inline-flex items-center gap-0.5 rounded-md border border-dashed px-1.5 py-0.5 text-[0.625rem] leading-tight",
    TONE_CLASSES[tone],
    onClick && "cursor-pointer transition-colors hover:bg-surface-700/40",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} className={classes}>
        {mark}
        {label}
      </button>
    );
  }

  return (
    <span aria-label={ariaLabel} className={classes}>
      {mark}
      {label}
    </span>
  );
}
