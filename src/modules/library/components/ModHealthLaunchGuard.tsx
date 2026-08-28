import { PlugsIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";

import { Button, Popover } from "@/components";
import { useModHealthDrawerStore } from "@/stores";

import { useBrokenEnabledMods } from "../api";

/** Starts a launch, or holds it until the reader has answered for what it carries. */
export type GuardedLaunch = (launch: () => void) => void;

interface ModHealthLaunchGuardProps {
  /** The launch controls, given the wrapper every one of their actions goes through. */
  children: (ask: GuardedLaunch) => ReactNode;
}

/**
 * Asks before a patch carries mods a health check found broken.
 *
 * Per "Launching with something broken" in docs/ux/MOD_HEALTH.md. Every way into
 * a launch takes the same wrapper, so the split menu cannot become the route
 * around the ask - which is what it was while only the button carried it.
 *
 * The ask is anchored under the controls rather than raised as a dialog, so the
 * button that caused it stays in view while it is answered. That is also why the
 * held launch lives here: a menu item is gone from the screen by the time the
 * reader answers, and something has to still be holding what they pressed.
 */
export function ModHealthLaunchGuard({ children }: ModHealthLaunchGuardProps) {
  const broken = useBrokenEnabledMods();
  const openDrawer = useModHealthDrawerStore((s) => s.openDrawer);
  const requestRepair = useModHealthDrawerStore((s) => s.requestRepair);
  const anchor = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<(() => void) | null>(null);

  const repairable = broken.filter((verdict) => verdict.health === "repairable").length;

  const ask: GuardedLaunch = (launch) => {
    if (broken.length === 0) {
      launch();
      return;
    }
    setHeld(() => launch);
  };

  function launchAnyway() {
    held?.();
    setHeld(null);
  }

  function showTheList() {
    setHeld(null);
    /* "Repair first" repairs. Opening the list and leaving the reader to find
       the button again is the same press asked for twice, and the drawer comes
       up either way so the run has somewhere to report. */
    if (repairable > 0) {
      requestRepair();
      return;
    }
    openDrawer();
  }

  return (
    <div ref={anchor} className="inline-flex">
      {children(ask)}
      <Popover.Root open={held !== null} onOpenChange={(next) => !next && setHeld(null)}>
        <Popover.Portal>
          <Popover.Positioner anchor={anchor} side="bottom" align="end" sideOffset={8}>
            <Popover.Popup className="w-80 p-3">
              <Popover.Title>Launch with {count(broken.length)}?</Popover.Title>
              <Popover.Description className="mt-1 text-xs">
                <Consequence repairable={repairable} />
              </Popover.Description>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="filled"
                  size="sm"
                  className="flex-1"
                  onClick={showTheList}
                  left={<WayOutIcon repairable={repairable} />}
                >
                  {wayOut(repairable)}
                </Button>
                <Button variant="outline" size="sm" onClick={launchAnyway}>
                  Launch anyway
                </Button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** What the reader is being warned about, which is what a repair can do for them. */
function Consequence({ repairable }: { repairable: number }) {
  if (repairable === 0) {
    return <>Mod issues detected, and none of them can be repaired automatically.</>;
  }

  return <>Mod issues detected, repairing first is recommended.</>;
}

function count(broken: number): string {
  return `${broken} broken mod${broken === 1 ? "" : "s"}`;
}

/** The other button offers a repair only where one exists, or it promises a fix it has not got. */
function wayOut(repairable: number): string {
  return repairable > 0 ? "Repair first" : "Show me";
}

function WayOutIcon({ repairable }: { repairable: number }) {
  if (repairable === 0) return <WarningCircleIcon weight="duotone" className="h-4 w-4" />;
  return <PlugsIcon weight="duotone" className="h-4 w-4" />;
}
