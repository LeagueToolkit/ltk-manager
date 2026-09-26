import { DotsThreeVerticalIcon } from "@phosphor-icons/react";
import { createContext, type ReactNode, use } from "react";

import { IconButton, Popover, Tooltip } from "@/components";
import { m } from "@/i18n";

import { useToolbarWidth } from "./DocumentToolbar";

/** The toolbar width below which secondary controls leave the row for the kebab. */
const OVERFLOW_BELOW_PX = 360;

const InOverflowContext = createContext(false);

/** Whether a control draws inside the kebab rather than in the toolbar row. */
export function useInToolbarOverflow(): boolean {
  return use(InOverflowContext);
}

/**
 * A document's secondary toolbar controls, inline while the row has room and behind a kebab
 * when it does not.
 *
 * The search box stays outside it, so a narrow pane such as the side panel keeps the one
 * control a reader types into at full width.
 */
export function ToolbarOverflow({ children }: { children: ReactNode }) {
  const width = useToolbarWidth();
  if (width === null || width >= OVERFLOW_BELOW_PX) return children;

  return (
    <Popover.Root>
      <Tooltip content={m.editor_toolbar_more_label()}>
        <Popover.Trigger
          render={
            <IconButton
              size="xs"
              compact
              variant="ghost"
              icon={<DotsThreeVerticalIcon weight="bold" className="size-4" />}
              aria-label={m.editor_toolbar_more_action()}
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup
            data-ui="ToolbarOverflow"
            aria-label={m.editor_toolbar_more_action()}
            className="flex items-center gap-2 bg-surface-900 p-2 select-none"
          >
            <InOverflowContext value>{children}</InOverflowContext>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
