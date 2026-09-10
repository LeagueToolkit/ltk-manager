import { NumberField as BaseNumberField } from "@base-ui/react/number-field";

import { twMerge } from "@/utils";

interface NumberFieldProps {
  value: number;
  /** Fires on every keystroke. `null` while the field is empty. */
  onValueChange: (value: number | null) => void;
  /** Fires once the field loses focus or the user presses enter. `null` if the field is empty. */
  onValueCommitted?: (value: number | null) => void;
  /** The minimum value of the field. */
  min?: number;
  /** The maximum value of the field. */
  max?: number;
  /** The step increment of the field. */
  step?: number;
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
      disabled={disabled}
    >
      <BaseNumberField.Input
        aria-label={ariaLabel}
        className={twMerge(
          "w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5",
          "text-right font-mono text-xs text-surface-300",
          "hover:border-surface-600 hover:bg-surface-800 hover:text-surface-200",
          "focus:border-accent-500 focus:bg-surface-800 focus:text-surface-100 focus:outline-none",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      />
    </BaseNumberField.Root>
  );
}
