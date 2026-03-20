import { Radio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup, type RadioGroupProps } from "@base-ui/react/radio-group";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * RadioGroup - A group of mutually exclusive options.
 *
 * @example
 * ```tsx
 * <RadioGroup.Root value={format} onValueChange={setFormat}>
 *   <RadioGroup.Label>Output Format</RadioGroup.Label>
 *   <RadioGroup.Options>
 *     <RadioGroup.Card value="modpkg" title=".modpkg" description="Full support" />
 *     <RadioGroup.Card value="fantome" title=".fantome" description="Legacy format" />
 *   </RadioGroup.Options>
 * </RadioGroup.Root>
 * ```
 */

export interface RadioGroupRootProps extends Omit<RadioGroupProps, "className"> {
  className?: string;
  children?: ReactNode;
}

export const RadioGroupRoot = forwardRef<HTMLDivElement, RadioGroupRootProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <BaseRadioGroup ref={ref} className={twMerge("flex flex-col gap-2", className)} {...props}>
        {children}
      </BaseRadioGroup>
    );
  },
);
RadioGroupRoot.displayName = "RadioGroup.Root";

export interface RadioGroupLabelProps {
  className?: string;
  children?: ReactNode;
}

export function RadioGroupLabel({ className, children }: RadioGroupLabelProps) {
  return (
    <span className={twMerge("text-sm font-medium text-surface-300", className)}>{children}</span>
  );
}

export interface RadioGroupOptionsProps {
  className?: string;
  children?: ReactNode;
  orientation?: "horizontal" | "vertical";
}

export function RadioGroupOptions({
  className,
  children,
  orientation = "horizontal",
}: RadioGroupOptionsProps) {
  return (
    <div className={twMerge("flex gap-3", orientation === "vertical" && "flex-col", className)}>
      {children}
    </div>
  );
}

export interface RadioGroupCardProps extends Omit<Radio.Root.Props, "className" | "children"> {
  title: string;
  description?: string;
  className?: string;
}

export const RadioGroupCard = forwardRef<HTMLButtonElement, RadioGroupCardProps>(
  ({ title, description, className, ...props }, ref) => {
    return (
      <Radio.Root
        ref={ref}
        className={twMerge(
          "flex-1 cursor-pointer rounded-lg border p-3 text-left transition-all",
          "border-surface-600 hover:border-surface-500",
          "data-[checked]:border-accent-500 data-[checked]:bg-accent-500/10",
          "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-800 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <div className="font-medium text-surface-100">{title}</div>
        {description && <div className="text-xs text-surface-400">{description}</div>}
      </Radio.Root>
    );
  },
);
RadioGroupCard.displayName = "RadioGroup.Card";

export interface RadioGroupItemProps extends Omit<Radio.Root.Props, "className" | "children"> {
  label?: ReactNode;
  description?: string;
  className?: string;
}

export const RadioGroupItem = forwardRef<HTMLButtonElement, RadioGroupItemProps>(
  ({ label, description, className, ...props }, ref) => {
    return (
      <Radio.Root
        ref={ref}
        className={twMerge(
          "group flex cursor-pointer items-start gap-3",
          "focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <Radio.Indicator
          className={twMerge(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            "border-surface-600 bg-surface-800",
            "group-hover:border-surface-500",
            "group-focus-visible:ring-2 group-focus-visible:ring-accent-500 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-surface-900",
            "group-data-[checked]:border-accent-600 group-data-[checked]:bg-accent-600",
          )}
        >
          <span className="hidden h-2 w-2 rounded-full bg-white group-data-[checked]:block" />
        </Radio.Indicator>
        {(label || description) && (
          <div className="flex flex-col">
            {label && <span className="text-sm text-surface-100">{label}</span>}
            {description && <span className="text-xs text-surface-400">{description}</span>}
          </div>
        )}
      </Radio.Root>
    );
  },
);
RadioGroupItem.displayName = "RadioGroup.Item";

export const RadioGroup = {
  Root: RadioGroupRoot,
  Label: RadioGroupLabel,
  Options: RadioGroupOptions,
  Card: RadioGroupCard,
  Item: RadioGroupItem,
};
