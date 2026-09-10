import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { forwardRef } from "react";

import { twMerge } from "@/utils";

export interface SeparatorProps extends Omit<BaseSeparator.Props, "className"> {
  className?: string;
}

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(
  ({ orientation = "horizontal", className, ...props }, ref) => {
    return (
      <BaseSeparator
        ref={ref}
        orientation={orientation}
        className={twMerge(
          "shrink-0 bg-surface-600",
          orientation === "vertical" ? "mx-2 h-5 w-px" : "my-2 h-px w-full",
          className,
        )}
        {...props}
      />
    );
  },
);
Separator.displayName = "Separator";
