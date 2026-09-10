import type { ReactNode } from "react";

import { twMerge } from "@/utils";

export interface CodeProps {
  children: ReactNode;
  className?: string;
}

/**
 * A literal set apart from what surrounds it - a type, a hash, a path, an id.
 *
 * DS-CODE-CHIP. The fill is a veil rather than a rung because the same chip is
 * drawn on a list row and inside a tooltip, which sit on different grounds.
 *
 * A path is one long token, so it breaks where it has to and each line of a
 * wrapped chip carries the whole shape rather than half of one.
 */
export function Code({ children, className }: CodeProps) {
  return (
    <code
      data-ui="Code"
      className={twMerge(
        "rounded-sm bg-surface-veil-soft px-1 py-px font-mono text-code leading-normal break-words text-surface-200",
        "box-decoration-clone",
        className,
      )}
    >
      {children}
    </code>
  );
}
