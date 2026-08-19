import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Button } from "./Button";

export interface TogglePillProps {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Sits before the label, sized against the pill rather than the text. */
  icon?: ReactNode;
  className?: string;
}

const activeClass = "border-accent-500/50 bg-accent-500/15 text-accent-300 hover:bg-accent-500/25";
const idleClass =
  "border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-500 hover:bg-surface-700 hover:text-surface-100";

/** A chip that is either on or off, reading as on through its accent fill. */
export function TogglePill({ label, active, onClick, icon, className }: TogglePillProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      compact
      aria-pressed={active}
      onClick={onClick}
      left={icon}
      className={twMerge("border px-2.5 font-normal", active ? activeClass : idleClass, className)}
    >
      {label}
    </Button>
  );
}
