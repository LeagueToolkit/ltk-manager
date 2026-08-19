import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Button } from "./Button";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name, required when the label is an icon. */
  name?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** A control for the whole group, seated in the track behind a divider. */
  action?: ReactNode;
  className?: string;
}

const activeSegmentClass = "bg-accent-500/15 text-accent-300 hover:bg-accent-500/20";

/* The track sets the height rather than the segments, so the border sits inside a
   36px box like every other control in a toolbar row. Segments take h-full to
   drop the size class that would otherwise stop them stretching. */
const segmentClass = "h-full rounded-none";

/* Set from the track so the action, whose markup this component does not own, is covered:
   the outer children round their own fill rather than lean on the track to clip it. */
const trackCornerClass = "[&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md";

/** A row of mutually exclusive choices sharing one track. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  action,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={twMerge(
        "inline-flex h-8 items-stretch overflow-hidden rounded-md border border-surface-600 bg-transparent",
        trackCornerClass,
        className,
      )}
      role="group"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          variant="ghost"
          size="sm"
          compact
          aria-pressed={option.value === value}
          aria-label={option.name}
          onClick={() => onChange(option.value)}
          className={twMerge(segmentClass, option.value === value && activeSegmentClass)}
        >
          {option.label}
        </Button>
      ))}
      {action && (
        <>
          <span className="w-px self-stretch bg-surface-600" aria-hidden />
          {action}
        </>
      )}
    </div>
  );
}
