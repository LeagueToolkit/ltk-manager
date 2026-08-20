import { DotsThreeIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

import { IconButton, Popover } from "@/components";

export interface DocumentActionsMenuProps {
  /** The slot element, once mounted. What the surface offers its documents. */
  slot: HTMLElement | null;
  /** Reports the slot up, so the surface can hand it to the active document. */
  onSlot: (slot: HTMLElement | null) => void;
}

/**
 * The active document's own chrome, behind one button in the tab strip.
 *
 * Inline, a document's controls take the strip's width from the tabs beside
 * them, and on a full strip the tabs and their scroll track are left fighting
 * over what is left. Behind a button the width is the tabs' alone.
 *
 * A popover rather than a menu, because a document contributes whatever chrome
 * it needs - toggles, a zoom, a segmented control - and a menu's keyboard model
 * only fits a list of items.
 *
 * The slot stays mounted whether the popover is open or not, since a document
 * portals into it as it renders rather than when the popover opens. That is
 * also what lets the button know whether it has anything to show.
 */
export function DocumentActionsMenu({ slot, onSlot }: DocumentActionsMenuProps) {
  const filled = useFilled(slot);

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <IconButton
            icon={<DotsThreeIcon className="h-4 w-4" weight="bold" />}
            variant="ghost"
            size="xs"
            compact
            aria-label="Document actions"
            /* Out of the layout rather than dimmed, so a document with no
               chrome of its own gives the strip every pixel back. */
            className={twMerge("mr-2 ml-1.5", !filled && "hidden")}
          />
        }
      />
      <Popover.Portal keepMounted>
        <Popover.Positioner align="end">
          <Popover.Popup className="flex items-center gap-1 p-1">
            <div
              ref={onSlot}
              data-ui="DocumentActionsMenu:slot"
              className="flex items-center gap-1"
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Whether the active document has put anything in the slot. */
function useFilled(slot: HTMLElement | null): boolean {
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!slot) {
      setFilled(false);
      return;
    }

    const read = () => setFilled(slot.childNodes.length > 0);
    read();

    /* The slot fills from a portal, so nothing in this tree re-renders when a
       document contributes chrome or takes it away. */
    const observer = new MutationObserver(read);
    observer.observe(slot, { childList: true });
    return () => observer.disconnect();
  }, [slot]);

  return filled;
}
