import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import type { ReactNode } from "react";

import { twMerge } from "@/utils";

interface NumberFieldProps {
  value: number;
  /** Fires on every keystroke, and on every step of a scrub. `null` while the field is empty. */
  onValueChange: (value: number | null) => void;
  /**
   * Fires once the field loses focus, the user presses enter, or a scrub is let go. `null`
   * if the field is empty.
   */
  onValueCommitted?: (value: number | null) => void;
  /** The minimum value of the field. */
  min?: number;
  /** The maximum value of the field. */
  max?: number;
  /** The step increment of the field, which is also what one scrubbed pixel moves it. */
  step?: number;
  /** How the value reads in the field. */
  format?: Intl.NumberFormatOptions;
  /** A label before the input that changes the value when dragged sideways. */
  scrub?: ReactNode;
  /** Classes for the label that scrubs, merged over its own. */
  scrubClassName?: string;
  /** Classes for the element holding the label and the input, merged over its own. */
  rootClassName?: string;
  /** Whether the field is disabled. */
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/* Reads as plain text until it is hovered or focused, so it can sit inline as a
   readout rather than announcing itself as a form control. */
export function NumberField({
  value,
  onValueChange,
  onValueCommitted,
  min,
  max,
  step,
  format,
  scrub,
  scrubClassName,
  rootClassName,
  disabled,
  "aria-label": ariaLabel,
  className,
}: NumberFieldProps) {
  return (
    <BaseNumberField.Root
      value={value}
      onValueChange={(next) => onValueChange(next)}
      onValueCommitted={(next) => onValueCommitted?.(next)}
      min={min}
      max={max}
      step={step}
      format={format}
      disabled={disabled}
      className={
        twMerge(scrub !== undefined && "flex min-w-0 items-center", rootClassName) || undefined
      }
    >
      {scrub !== undefined && (
        <BaseNumberField.ScrubArea
          className={twMerge(
            "shrink-0 px-0.5 text-surface-400 select-none",
            !disabled && "cursor-ew-resize hover:text-surface-200",
            scrubClassName,
          )}
        >
          {scrub}
        </BaseNumberField.ScrubArea>
      )}
      <BaseNumberField.Input
        aria-label={ariaLabel}
        className={twMerge(
          "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5",
          "text-right font-mono text-xs text-surface-300",
          "enabled:hover:border-surface-600 enabled:hover:bg-surface-800 enabled:hover:text-surface-200",
          "focus:border-accent-500 focus:bg-surface-800 focus:text-surface-100 focus:outline-none",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      />
    </BaseNumberField.Root>
  );
}
