import type { ReactNode } from "react";

import { twMerge } from "@/utils";

interface ButtonGroupProps {
  children: ReactNode;
  className?: string;
}

const joinClass =
  "[&>*:focus-visible]:relative [&>*:focus-visible]:z-10 [&>*:hover]:relative [&>*:hover]:z-10 " +
  "[&>*:not(:nth-child(1_of_:not(span)))]:-ml-px " +
  "[&>*:not(:nth-child(1_of_:not(span)))]:rounded-l-none " +
  "[&>*:not(:nth-last-child(1_of_:not(span)))]:rounded-r-none";

export function ButtonGroup({ children, className }: ButtonGroupProps) {
  return (
    <div role="group" className={twMerge("inline-flex", joinClass, className)}>
      {children}
    </div>
  );
}
