import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface ButtonGroupProps {
  children: ReactNode;
  className?: string;
}

/* Each button carries its own border, so they overlap by a pixel to share one edge.
   A hovered or focused button rises above its neighbours to keep that edge whole. */
const joinClass =
  "[&>*:focus-visible]:relative [&>*:focus-visible]:z-10 [&>*:hover]:relative [&>*:hover]:z-10 [&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none";

export function ButtonGroup({ children, className }: ButtonGroupProps) {
  return (
    <div role="group" className={twMerge("inline-flex", joinClass, className)}>
      {children}
    </div>
  );
}
