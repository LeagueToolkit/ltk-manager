import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";

import { twMerge } from "@/utils";

export interface StepperFieldProps {
  value: number;
  /** Fires with every value the field parses, and never while it is empty. */
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  /** What an arrow, or the Up and Down keys, move the value by. */
  step?: number;
  /** The move while Alt is held. */
  smallStep?: number;
  /** The move while Shift is held. */
  largeStep?: number;
  /** The digits always drawn after the point. */
  decimals?: number;
  /** The locale the value is read and drawn in, which decides the decimal separator. */
  locale?: Intl.LocalesArgument;
  /** The arrows' own names, since base-ui's defaults are English. */
  increaseLabel: string;
  decreaseLabel: string;
  "aria-label"?: string;
  /** The width and the type tier, which the input's mono is measured against. */
  className?: string;
}

/** A number typed in, with a pair of arrows on its right that nudge it by a step. */
export function StepperField({
  value,
  onValueChange,
  min,
  max,
  step,
  smallStep,
  largeStep,
  decimals,
  locale,
  increaseLabel,
  decreaseLabel,
  "aria-label": ariaLabel,
  className,
}: StepperFieldProps) {
  const format =
    decimals === undefined
      ? undefined
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };

  return (
    <BaseNumberField.Root
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      min={min}
      max={max}
      step={step}
      smallStep={smallStep}
      largeStep={largeStep}
      format={format}
      locale={locale}
    >
      <BaseNumberField.Group
        data-ui="StepperField"
        className={twMerge(
          /* DS-VEIL, DS-HOVER, DS-RADIUS */
          "inline-flex items-stretch overflow-hidden rounded-sm border border-surface-veil transition-colors",
          "focus-within:border-accent-500 hover:border-accent-hover",
          className,
        )}
      >
        <BaseNumberField.Input
          aria-label={ariaLabel}
          className="w-full min-w-0 bg-surface-veil-soft px-1.5 py-0.5 text-right font-mono text-code text-surface-200 tabular-nums focus:outline-none"
        />
        <span className="flex flex-col border-l border-surface-veil">
          <BaseNumberField.Increment aria-label={increaseLabel} className={ARROW}>
            <CaretUpIcon weight="bold" className="h-2.5 w-2.5" />
          </BaseNumberField.Increment>
          <BaseNumberField.Decrement aria-label={decreaseLabel} className={ARROW}>
            <CaretDownIcon weight="bold" className="h-2.5 w-2.5" />
          </BaseNumberField.Decrement>
        </span>
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  );
}

/* DS-VEIL */
const ARROW =
  "flex flex-1 items-center justify-center px-1 text-surface-400 transition-colors hover:bg-surface-veil hover:text-surface-200 active:bg-surface-veil-strong disabled:opacity-40";
