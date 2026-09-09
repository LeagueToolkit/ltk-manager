import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

import { twMerge } from "@/utils";

/** Hover for this long before the card opens, the tooltip delay. */
const OPEN_DELAY = 600;

/** Long enough to travel from the trigger into the card. */
const CLOSE_DELAY = 120;

export interface HoverCardProps {
  /** What the card reads. Mounted when the card opens. */
  content: ReactNode;
  /** The element the card hangs off. Takes no click and no tab stop. */
  children: ReactElement<Record<string, unknown>>;
  /** The card's accessible name. */
  label: string;
  /** The popup's own classes, its width above all. */
  className?: string;
}

/**
 * A card that reads a thing while the pointer is on it, per `DS-MENU-SCOPE`.
 *
 * The trigger stays part of whatever row it sits in, so the row keeps its own click. The
 * pointer reaches the card itself, which is what lets a reader scroll it and select from it.
 */
export function HoverCard({ content, children, label, className }: HoverCardProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={OPEN_DELAY} closeDelay={CLOSE_DELAY} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side="bottom" align="start" sideOffset={0} className="z-50">
          <BaseTooltip.Popup
            /* Base UI marks the trigger with `aria-describedby` and leaves the popup bare. */
            role="tooltip"
            aria-label={label}
            className={twMerge(
              /* DS-RADIUS, DS-GROUND */
              "rounded-lg border border-surface-600 bg-surface-800 p-3 text-meta shadow-xl outline-none select-none",
              "transition-[opacity,transform] duration-200 ease-out",
              "data-starting-style:-translate-y-1 data-starting-style:opacity-0",
              "data-ending-style:-translate-y-1 data-ending-style:opacity-0",
              className,
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
