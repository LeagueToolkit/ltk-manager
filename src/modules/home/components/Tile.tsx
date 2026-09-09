import type { ReactNode } from "react";

import { twMerge } from "@/utils";

interface TileProps {
  title: string;
  /** One control at the header's trailing edge. */
  action?: ReactNode;
  /** A row ruled off under the body, for what the tile leads out to. */
  foot?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-ui": string;
}

/** One titled panel of the right column, framed as the library frames its own. */
export function Tile({ title, action, foot, children, className, "data-ui": dataUi }: TileProps) {
  return (
    <section
      data-ui={dataUi}
      /* DS-GROUND. */
      className={twMerge(
        "flex shrink-0 flex-col rounded-xl border border-surface-700/50 bg-surface-900/95",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 select-none">
        <h2 className="text-sm font-semibold text-surface-100">{title}</h2>
        {action}
      </header>
      {children}
      {foot && <div className="border-t border-surface-700/50 px-2 py-2">{foot}</div>}
    </section>
  );
}
