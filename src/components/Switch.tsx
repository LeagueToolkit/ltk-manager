import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { forwardRef } from "react";
import { twMerge } from "tailwind-merge";

export interface SwitchProps extends Omit<BaseSwitch.Root.Props, "className"> {
  className?: string;
}

const trackClass = "h-5 w-9";
const thumbClass = "top-1 left-1 h-3 w-3 data-[checked]:translate-x-4";

export const Switch = forwardRef<HTMLSpanElement, SwitchProps>(({ className, ...props }, ref) => {
  return (
    <BaseSwitch.Root
      ref={ref}
      className={twMerge(
        "relative inline-flex shrink-0 cursor-pointer rounded-md transition-colors",
        "bg-surface-700 data-[checked]:bg-accent-500",
        "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900 focus-visible:outline-none",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        trackClass,
        className,
      )}
      {...props}
    >
      {/* The knob inverts with the theme on purpose: DS-INVARIANT. The scale is
            optical, not a size change: DS-POLARITY. */}
      <BaseSwitch.Thumb
        className={twMerge(
          "absolute rounded-md transition",
          "bg-surface-400 data-[checked]:scale-110 data-[checked]:bg-surface-900",
          thumbClass,
        )}
      />
    </BaseSwitch.Root>
  );
});
Switch.displayName = "Switch";
