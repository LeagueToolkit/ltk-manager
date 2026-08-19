import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "@phosphor-icons/react";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export type CheckboxSize = "sm" | "md" | "lg";

export interface CheckboxProps extends Omit<BaseCheckbox.Root.Props, "className" | "render"> {
  size?: CheckboxSize;
  label?: ReactNode;
  description?: string;
  className?: string;
}

const sizeClasses: Record<CheckboxSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

const iconSizeClasses: Record<CheckboxSize, string> = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
};

const labelSizeClasses: Record<CheckboxSize, string> = {
  sm: "text-sm",
  md: "text-sm",
  lg: "text-base",
};

/* A dark mark on a bright fill reads lighter (DS-POLARITY) and bold is already
   phosphor's heaviest, so the filled path is stroked in its own color to fatten
   it. The width is in the icon's 256-unit viewBox, not pixels. */
const MARK_STROKE = 16;

function CheckboxIcon({ size }: { size: CheckboxSize }) {
  return (
    <>
      <CheckIcon
        weight="bold"
        stroke="currentColor"
        strokeWidth={MARK_STROKE}
        className={twMerge(iconSizeClasses[size], "hidden group-data-[checked]:block")}
      />
      <MinusIcon
        weight="bold"
        stroke="currentColor"
        strokeWidth={MARK_STROKE}
        className={twMerge(iconSizeClasses[size], "hidden group-data-[indeterminate]:block")}
      />
    </>
  );
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ size = "md", label, description, className, disabled, ...props }, ref) => {
    const checkbox = (
      <BaseCheckbox.Root
        ref={ref}
        disabled={disabled}
        className={twMerge(
          "group inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors",
          sizeClasses[size],
          "border-surface-600 bg-surface-800",
          "hover:border-surface-500 hover:bg-surface-700",
          "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900 focus-visible:outline-none",
          "data-[checked]:border-accent-500 data-[checked]:bg-accent-500",
          "data-[checked]:hover:border-accent-400 data-[checked]:hover:bg-accent-400",
          "data-[indeterminate]:border-accent-500 data-[indeterminate]:bg-accent-500",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !label && className,
        )}
        {...props}
      >
        {/* The mark inverts with the theme on purpose, as the switch knob does:
            DS-INVARIANT. */}
        <BaseCheckbox.Indicator className="flex items-center justify-center text-surface-900">
          <CheckboxIcon size={size} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
    );

    if (!label) {
      return checkbox;
    }

    return (
      <label
        className={twMerge(
          "inline-flex cursor-pointer items-start gap-3",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        {checkbox}
        <div className="flex min-w-0 flex-col">
          <span className={twMerge("text-surface-100", labelSizeClasses[size])}>{label}</span>
          {description && <span className="mt-0.5 text-xs text-surface-400">{description}</span>}
        </div>
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";

// Checkbox Group
export interface CheckboxGroupProps {
  children: ReactNode;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

export function CheckboxGroup({
  children,
  className,
  orientation = "vertical",
}: CheckboxGroupProps) {
  return (
    <div
      role="group"
      className={twMerge(
        "flex",
        orientation === "vertical" ? "flex-col gap-3" : "flex-row flex-wrap gap-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
