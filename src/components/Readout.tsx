import type { MouseEvent as ReactMouseEvent } from "react";

import { twMerge } from "@/utils";

export interface ReadoutProps {
  /**
   * The value as text, which is the only shape that carries every kind.
   *
   * A 64-bit integer does not survive a JS number, so a caller holding one passes the
   * digits it was given rather than parsing them.
   */
  value: string;
  /** The letter naming one component of a vector or a colour, drawn left of the value. */
  label?: string;
  "aria-label"?: string;
  /** The room the value takes. Not the label, which is as wide as its letter. */
  className?: string;
}

/**
 * A value in the field it will be edited in, before it can be.
 *
 * The field is drawn at rest rather than on hover, so a value reads as something the
 * document holds rather than as text laid over the row. It takes no focus, because a
 * document of them would otherwise be a tab order thousands of stops long.
 */
export function Readout({ value, label, "aria-label": ariaLabel, className }: ReadoutProps) {
  const field = (
    <input
      type="text"
      readOnly
      tabIndex={-1}
      value={value}
      aria-label={ariaLabel ?? label}
      data-ui="Readout"
      className={twMerge(
        "min-w-0 cursor-default bg-surface-veil-soft px-1.5 py-0.5",
        "font-mono text-surface-200 tabular-nums select-text focus:outline-none",
        /* DS-VEIL, DS-HOVER, DS-RADIUS. The wrapper draws them for a labelled one. */
        label === undefined &&
          "rounded-sm border border-surface-veil transition-colors hover:border-accent-hover",
        className,
      )}
      onClick={keepRowShut}
    />
  );

  if (label === undefined) return field;

  /* The letter rides a rung above the value, so the pair reads as one control with a
     named half rather than as a caption beside a box. */
  return (
    <span
      /* DS-VEIL, DS-HOVER, DS-RADIUS */
      className="inline-flex items-stretch overflow-hidden rounded-sm border border-surface-veil transition-colors hover:border-accent-hover"
    >
      <span
        aria-hidden
        /* DS-WEIGHT-TIER: weight rather than size, which a dense row has no room for. */
        className="flex items-center bg-surface-veil px-1.5 font-mono font-semibold text-surface-300 select-none"
      >
        {label}
      </span>
      {field}
    </span>
  );
}

/* The field is a control of its own, so a click that lands in it is not the row's. */
function keepRowShut(event: ReactMouseEvent<HTMLInputElement>) {
  event.stopPropagation();
}
