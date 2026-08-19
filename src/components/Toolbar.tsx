import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export interface ToolbarProps {
  children: ReactNode;
  className?: string;
}

/* The divider is two rungs under the usual surface-600 because the strip and the
   page beneath it share the ground, so it separates two identical colors and
   anything stronger reads as a rule drawn across the window. */

/** The chrome strip under the titlebar, holding a row of controls and anything below it. */
export function Toolbar({ children, className }: ToolbarProps) {
  return (
    <div className={twMerge("bg-surface-950", className)} data-tauri-drag-region>
      {children}
    </div>
  );
}

/* The row stands as tall as a size="md" control whether or not the page carries one,
   so the strip matches across pages. box-content keeps the min-height off the padding,
   and the token tracks the zoom scale that a pixel value would miss. */
const rowClass = "box-content flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2";

/** One line of toolbar controls, wrapping to a second line when the window is narrow. */
export function ToolbarRow({ children, className }: ToolbarProps) {
  return <div className={twMerge(rowClass, className)}>{children}</div>;
}
