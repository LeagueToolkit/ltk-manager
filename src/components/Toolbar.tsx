import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export interface ToolbarProps {
  children: ReactNode;
  className?: string;
  "data-ui"?: string;
}

/** The chrome strip under the titlebar, holding a row of controls and anything below it. */
export function Toolbar({ children, className, "data-ui": dataUi }: ToolbarProps) {
  return (
    <div className={twMerge("bg-surface-950", className)} data-ui={dataUi} data-tauri-drag-region>
      {children}
    </div>
  );
}

/** One line of toolbar controls, wrapping to a second line when the window is narrow. */
export function ToolbarRow({ children, className, "data-ui": dataUi }: ToolbarProps) {
  return (
    <div
      className={twMerge(
        "box-content flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2",
        className,
      )}
      data-ui={dataUi}
    >
      {children}
    </div>
  );
}
