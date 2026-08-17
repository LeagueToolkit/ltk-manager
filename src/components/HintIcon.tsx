import { AlertTriangle, Info, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Tooltip } from "./Tooltip";

export type HintIconVariant = "info" | "warning";

const variantStyles: Record<HintIconVariant, string> = {
  info: "text-surface-400 hover:text-surface-200",
  warning: "text-warning-text hover:text-warning",
};

const defaultIcons: Record<HintIconVariant, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
};

export interface HintIconProps {
  /** Text or nodes shown in the tooltip on hover/focus. */
  content: ReactNode;
  /** Visual treatment. `info` is muted and `warning` is amber. Defaults to `info`. */
  variant?: HintIconVariant;
  /** Override the icon. Defaults to the variant's icon. */
  icon?: LucideIcon;
  /** Accessible label for the trigger. Defaults to "More information". */
  label?: string;
  /** Tooltip side. Defaults to "top". */
  side?: "top" | "right" | "bottom" | "left";
  /** Extra classes merged onto the trigger button. */
  className?: string;
}

/**
 * A small icon that reveals explanatory text in a tooltip on hover or focus.
 * Rendered as a focusable button so it's keyboard-accessible, and safe to place
 * inside a `<label>` since labels ignore clicks on interactive descendants.
 */
export function HintIcon({
  content,
  variant = "info",
  icon,
  label = "More information",
  side = "top",
  className,
}: HintIconProps) {
  const Icon = icon ?? defaultIcons[variant];

  return (
    <Tooltip content={<span className="block max-w-[16rem]">{content}</span>} side={side}>
      <button
        type="button"
        aria-label={label}
        className={twMerge(
          "inline-flex shrink-0 cursor-help transition-colors",
          variantStyles[variant],
          className,
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}
