import { forwardRef, type ReactNode } from "react";

import { twMerge } from "@/utils";

import { Button, type ButtonProps } from "./Button";

export interface TogglePillProps extends Omit<
  ButtonProps,
  "children" | "left" | "right" | "variant" | "compact"
> {
  label: string;
  active: boolean;
  /** Sits before the label, sized against the pill rather than the text. */
  icon?: ReactNode;
  /** A tally the pill carries after its label, such as what it would reveal. */
  count?: number;
}

const activeClass = "border-accent-500/50 bg-accent-500/15 text-accent-300 hover:bg-accent-500/25";
const idleClass =
  "border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-500 hover:bg-surface-700 hover:text-surface-100";

/** A chip that is either on or off, reading as on through its accent fill. */
export const TogglePill = forwardRef<HTMLButtonElement, TogglePillProps>(
  ({ label, active, icon, count, size = "sm", className, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size={size}
        compact
        aria-pressed={active}
        left={icon}
        className={twMerge(
          "border px-2.5 font-normal",
          active ? activeClass : idleClass,
          className,
        )}
        {...props}
      >
        {label}
        {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
      </Button>
    );
  },
);

TogglePill.displayName = "TogglePill";
