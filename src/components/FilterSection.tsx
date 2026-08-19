import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export interface FilterSectionProps {
  children: ReactNode;
  /** Omit where the section's own leading control already names it. */
  title?: string;
  icon?: ReactNode;
  /** A control for the whole section, pinned to the header's trailing edge. */
  action?: ReactNode;
  className?: string;
}

/** One labelled block of a filter popover, padded so the dividers between blocks run edge to edge. */
export function FilterSection({ title, children, icon, action, className }: FilterSectionProps) {
  return (
    <section className={twMerge("px-3 py-2.5", className)}>
      {title && (
        <div className="mb-1.5 flex min-h-6 items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-surface-400 uppercase">
            {icon}
            {title}
          </h4>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
