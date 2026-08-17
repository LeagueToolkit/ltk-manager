import { twMerge } from "tailwind-merge";

import { Button } from "./Button";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

const activeSegmentClass = "bg-accent-500/15 text-accent-300 hover:bg-accent-500/20";

/** A row of mutually exclusive choices sharing one track. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={twMerge("inline-flex gap-0.5 rounded-md bg-surface-800 p-0.5", className)}
      role="group"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          variant="ghost"
          size="sm"
          compact
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={option.value === value ? activeSegmentClass : undefined}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
