import { twMerge } from "tailwind-merge";

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  count?: number;
  rounded?: boolean;
  className?: string;
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  count = 1,
  rounded = true,
  className,
}: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={twMerge(
            "relative overflow-hidden bg-surface-700",
            rounded && "rounded-lg",
            className,
          )}
          style={{ width, height }}
        >
          <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-surface-600/40 to-transparent" />
        </div>
      ))}
    </>
  );
}
