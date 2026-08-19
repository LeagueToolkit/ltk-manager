import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export interface FilterColumnProps {
  children: ReactNode;
  title?: string;
  icon?: ReactNode;
  /** A full-bleed control standing in for the header, such as a search field. */
  head?: ReactNode;
  className?: string;
}

/* Every head is h-8 with the same underline, so the three columns line up and
   their rules read as one. */
const headClass =
  "flex h-8 shrink-0 items-center gap-1.5 border-b border-surface-600/50 px-3 text-xs font-medium tracking-wide text-surface-400 uppercase";

/** One scrolling column of a filter popover, so a long option list never wraps. */
export function FilterColumn({ title, icon, head, children, className }: FilterColumnProps) {
  return (
    <section className={twMerge("flex min-w-0 flex-1 flex-col", className)}>
      {head}
      {title && (
        <div className={headClass}>
          {icon}
          {title}
        </div>
      )}
      <div className="max-h-64 min-h-0 flex-auto overflow-y-auto px-3 py-2.5">
        <div className="flex flex-col gap-1">{children}</div>
      </div>
    </section>
  );
}
