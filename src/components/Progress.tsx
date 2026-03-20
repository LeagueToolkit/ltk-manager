import { Progress as BaseProgress } from "@base-ui/react/progress";
import { forwardRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export type ProgressSize = "sm" | "md";

const trackSizeClasses: Record<ProgressSize, string> = {
  sm: "h-1.5",
  md: "h-2",
};

// Root

export interface ProgressRootProps extends BaseProgress.Root.Props {
  children?: ReactNode;
  /** Text label displayed above the track on the left. */
  label?: ReactNode;
  /** Secondary label displayed above the track on the right (e.g. "3 / 10"). */
  valueLabel?: ReactNode;
}

export const ProgressRoot = ({ children, label, valueLabel, ...props }: ProgressRootProps) => {
  return (
    <BaseProgress.Root {...props}>
      {(label || valueLabel) && (
        <div className="mb-2 flex justify-between text-sm text-surface-300">
          {label && <span>{label}</span>}
          {valueLabel && <span>{valueLabel}</span>}
        </div>
      )}
      {children}
    </BaseProgress.Root>
  );
};
ProgressRoot.displayName = "Progress.Root";

// Track

export interface ProgressTrackProps extends Omit<BaseProgress.Track.Props, "className"> {
  className?: string;
  size?: ProgressSize;
}

export const ProgressTrack = forwardRef<HTMLDivElement, ProgressTrackProps>(
  ({ size = "md", className, ...props }, ref) => {
    return (
      <BaseProgress.Track
        ref={ref}
        className={twMerge(
          "overflow-hidden rounded-full bg-surface-700",
          trackSizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
ProgressTrack.displayName = "Progress.Track";

// Indicator

export interface ProgressIndicatorProps extends Omit<BaseProgress.Indicator.Props, "className"> {
  className?: string;
}

export const ProgressIndicator = forwardRef<HTMLDivElement, ProgressIndicatorProps>(
  ({ className, ...props }, ref) => {
    return (
      <BaseProgress.Indicator
        ref={ref}
        className={twMerge(
          "relative overflow-hidden rounded-full transition-all duration-300",
          "bg-accent-500",
          "data-[indeterminate]:w-1/3 data-[indeterminate]:animate-pulse",
          "after:absolute after:inset-0 after:animate-shimmer after:bg-linear-to-r after:from-transparent after:via-white/25 after:to-transparent",
          className,
        )}
        {...props}
      />
    );
  },
);
ProgressIndicator.displayName = "Progress.Indicator";

// Compound export

export const Progress = {
  Root: ProgressRoot,
  Track: ProgressTrack,
  Indicator: ProgressIndicator,
};
