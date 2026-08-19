import { forwardRef, type HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  shortcut: string;
  size?: "sm" | "md";
}

const sizeClasses = {
  sm: "px-1 py-0.5 text-[10px] min-w-[18px] gap-0.5",
  md: "px-1.5 py-0.5 text-xs min-w-[22px] gap-1",
} as const;

export const Kbd = forwardRef<HTMLElement, KbdProps>(
  ({ shortcut, size = "sm", className, ...props }, ref) => {
    const keys = shortcut.split("+");

    return (
      <span
        ref={ref}
        className={twMerge("inline-flex items-center", sizeClasses[size], className)}
        {...props}
      >
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="inline-flex items-center justify-center rounded-sm border border-b-2 border-surface-600 border-b-surface-500 bg-surface-700 px-1 font-mono leading-none text-surface-300"
          >
            {key}
          </kbd>
        ))}
      </span>
    );
  },
);
Kbd.displayName = "Kbd";
