import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { SearchEmptyPoroIcon } from "./icons";

export type EmptyStateSize = "xs" | "sm" | "md";

export interface EmptyStateProps {
  /** Defaults to the search poro. Size it yourself when overriding. */
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons offering the way out, for a container that is empty rather than filtered. */
  action?: ReactNode;
  /** `sm` for a panel or card, `md` for a whole page. Defaults to `md`. */
  size?: EmptyStateSize;
  className?: string;
}

/* An empty state is something you look past, so it sits a rung below ordinary
   text. The mark goes one lower still, where a caption could not follow. */
const SIZES: Record<EmptyStateSize, { root: string; icon: string; title: string; body: string }> = {
  xs: {
    root: "gap-1 py-3",
    icon: "text-surface-600",
    title: "text-xs font-medium text-surface-400",
    body: "max-w-xs text-xs text-surface-500",
  },
  sm: {
    root: "gap-1.5 py-4",
    icon: "mb-1 text-surface-600",
    title: "text-sm font-medium text-surface-400",
    body: "max-w-sm text-sm text-surface-500",
  },
  md: {
    root: "h-64 gap-1",
    icon: "mb-3 text-surface-600",
    title: "text-lg font-medium text-surface-400",
    body: "max-w-md text-surface-500",
  },
};

const DEFAULT_ICON: Record<EmptyStateSize, ReactNode> = {
  xs: <SearchEmptyPoroIcon className="h-9 w-9" />,
  sm: <SearchEmptyPoroIcon className="h-14 w-14" />,
  md: <SearchEmptyPoroIcon className="h-20 w-20" />,
};

/** Nothing to show: a mark, what happened, and the way out if there is one. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
  className,
}: EmptyStateProps) {
  const styles = SIZES[size];

  return (
    <div
      className={twMerge(
        "flex flex-col items-center justify-center text-center",
        styles.root,
        className,
      )}
    >
      <div className={styles.icon}>{icon ?? DEFAULT_ICON[size]}</div>
      {title && <h3 className={styles.title}>{title}</h3>}
      {description && <p className={styles.body}>{description}</p>}
      {action && <div className="mt-4 flex gap-3">{action}</div>}
    </div>
  );
}
