import { Loader2 } from "lucide-react";
import { twMerge } from "tailwind-merge";

const sizeClasses = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
} as const;

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <Loader2 className={twMerge("animate-spin text-surface-400", sizeClasses[size], className)} />
  );
}
