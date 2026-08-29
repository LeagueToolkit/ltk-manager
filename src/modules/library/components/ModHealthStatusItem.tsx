import { WarningCircleIcon, WrenchIcon } from "@phosphor-icons/react";

import { Button, Tooltip } from "@/components";
import { useModHealthDrawerStore } from "@/stores";

import { useModHealthStatus } from "../api";
import { toneOf } from "./modHealthNotice";

/**
 * What the library's mod health amounts to, as a cell in the status bar.
 *
 * Per "The status bar item" in docs/ux/MOD_HEALTH.md. The glyph carries the cell
 * and the words qualify it, so the label stays at the bar's own size while the
 * icon runs most of its height.
 */
export function ModHealthStatusItem() {
  const status = useModHealthStatus();
  const shown = useModHealthDrawerStore((s) => s.open);
  const hosted = useModHealthDrawerStore((s) => s.hosted);
  const openDrawer = useModHealthDrawerStore((s) => s.openDrawer);
  const close = useModHealthDrawerStore((s) => s.close);

  // The bar spans the app and the drawer is the library's, so away from it this
  // cell would be a press that does nothing.
  if (!status || !hosted) return null;

  const repairable = status.repairable.length;
  const tone = toneOf(repairable);
  const ItemIcon = repairable > 0 ? WrenchIcon : WarningCircleIcon;

  function toggle() {
    if (shown) {
      close();
      return;
    }
    openDrawer();
  }

  return (
    <Tooltip content={hint(shown)}>
      <Button
        variant="duotone"
        size="sm"
        onClick={toggle}
        aria-expanded={shown}
        /* Its own height, because the bar's is whatever the activity line needs -
           a stepper mid-build would stretch this into a panel. */
        className={`mr-1.5 h-6 shrink-0 gap-1 self-center rounded-sm px-2 text-row tabular-nums ${tone.cell} ${shown ? tone.held : ""}`}
      >
        <ItemIcon className="h-4 w-4 shrink-0" weight="bold" />
        {label(repairable, status.unrepairable.length)}
      </Button>
    </Tooltip>
  );
}

/** What the press will do, since the cell's own words only ever say the count. */
function hint(shown: boolean): string {
  if (shown) return "Hide the mods that need attention.";
  return "Some of your mods require attention. Open the list and repair them.";
}

/** The cell's own words, which have room for a count and little else. */
function label(repairable: number, unrepairable: number): string {
  if (repairable === 0) return `${unrepairable} broken`;
  return `${repairable} ${repairable === 1 ? "repair" : "repairs"}`;
}
