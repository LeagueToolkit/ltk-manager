import { type ReactElement, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ReactElement;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Re-grounds the panel, for a card that sits on something other than the page. */
  panelClassName?: string;
}

/**
 * A titled settings group: the heading sits on the page ground and the panel
 * below it holds only the rows, so a scan down the page reads as a list of
 * labelled groups rather than a stack of identical boxes.
 */
export function SectionCard({
  title,
  description,
  icon,
  action,
  children,
  className,
  panelClassName,
}: SectionCardProps) {
  return (
    <section className={twMerge("space-y-2", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
            {icon && <span className="text-surface-400">{icon}</span>}
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs text-surface-400">{description}</p>}
        </div>
        {action}
      </div>
      <div
        className={twMerge(
          "rounded-xl border border-surface-700/50 bg-surface-900/95 p-5",
          panelClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
