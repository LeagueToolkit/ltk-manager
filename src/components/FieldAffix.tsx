import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/** Styling for a control sitting inside a field, flush with its trailing edge. */
export const fieldAffixButtonClass =
  "h-full w-8 shrink-0 rounded-none text-surface-300 hover:bg-surface-600 hover:text-surface-100 active:bg-surface-500";

interface FieldAffixProps {
  children: ReactNode;
  className?: string;
}

/** Holds controls against a field's trailing edge, inside its border. */
export function FieldAffix({ children, className }: FieldAffixProps) {
  return (
    <div
      className={twMerge(
        "absolute inset-y-px right-px flex items-stretch overflow-hidden rounded-r-md",
        className,
      )}
    >
      {children}
    </div>
  );
}
