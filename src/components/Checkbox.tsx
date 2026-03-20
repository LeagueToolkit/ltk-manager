import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
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

function CheckboxIcon({ size }: { size: CheckboxSize }) {
  return (
    <>
      <Check
        className={twMerge(iconSizeClasses[size], "hidden group-data-[checked]:block")}
        strokeWidth={3}
      />
      <Minus
        className={twMerge(iconSizeClasses[size], "hidden group-data-[indeterminate]:block")}
        strokeWidth={3}
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
          "group inline-flex shrink-0 cursor-pointer items-center justify-center rounded border transition-colors",
          sizeClasses[size],
          "border-surface-600 bg-surface-800",
          "hover:border-surface-500 hover:bg-surface-700",
          "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900 focus-visible:outline-none",
          "data-[checked]:border-accent-600 data-[checked]:bg-accent-600",
          "data-[checked]:hover:border-accent-500 data-[checked]:hover:bg-accent-500",
          "data-[indeterminate]:border-accent-600 data-[indeterminate]:bg-accent-600",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !label && className,
        )}
        {...props}
      >
        <BaseCheckbox.Indicator className="flex items-center justify-center text-white">
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
        <div className="flex flex-col">
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
