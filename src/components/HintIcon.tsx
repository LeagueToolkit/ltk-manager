import { InfoIcon, WarningIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Tooltip } from "./Tooltip";

export type HintIconVariant = "info" | "warning";

/** Overrides Base UI's 600ms default, too slow for a glyph hovered on purpose. */
const HINT_DELAY = 150;

const variantStyles: Record<HintIconVariant, string> = {
  info: "text-info-text/70 hover:text-info-text",
  warning: "text-warning-text/70 hover:text-warning-text",
};

const defaultIcons: Record<HintIconVariant, ReactNode> = {
  info: <InfoIcon weight="duotone" className="h-4.5 w-4.5" />,
  warning: <WarningIcon weight="duotone" className="h-4.5 w-4.5" />,
};

export interface HintIconProps {
  /** Text or nodes shown in the tooltip on hover/focus. */
  content: ReactNode;
  /** Visual treatment. Defaults to `info`. */
  variant?: HintIconVariant;
  /** Override the glyph. Defaults to the variant's icon. */
  icon?: ReactNode;
  /** Accessible label for the trigger. Defaults to "More information". */
  label?: string;
  /** Tooltip side. Defaults to "top". */
  side?: "top" | "right" | "bottom" | "left";
  /** Extra classes merged onto the trigger button. */
  className?: string;
}

/**
 * A small icon that reveals explanatory text in a tooltip on hover or focus.
 *
 * Safe inside a `<label>`, which ignores clicks on interactive descendants.
 */
export function HintIcon({
  content,
  variant = "info",
  icon,
  label = "More information",
  side = "top",
  className,
}: HintIconProps) {
  return (
    <Tooltip
      content={<span className="block max-w-[16rem]">{content}</span>}
      side={side}
      delay={HINT_DELAY}
    >
      <button
        type="button"
        aria-label={label}
        className={twMerge(
          "inline-flex shrink-0 cursor-help rounded-full transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
          variantStyles[variant],
          className,
        )}
      >
        {icon ?? defaultIcons[variant]}
      </button>
    </Tooltip>
  );
}
