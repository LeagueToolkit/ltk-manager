import { PlugsIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";

import { Button, Popover } from "@/components";
import { useModHealthDrawerStore } from "@/stores";
import { twMerge } from "@/utils";

import { useHealthVerdicts } from "../api";
import { alarmOf } from "./modHealthNotice";

/** Starts a launch, or holds it until the reader has answered for what it carries. */
export type GuardedLaunch = (launch: () => void) => void;

interface ModHealthLaunchGuardProps {
  /** The launch controls, given the wrapper every one of their actions goes through. */
  children: (ask: GuardedLaunch) => ReactNode;
  /** Laid over the anchor, which is what decides how wide the controls may run. */
  className?: string;
}

/**
 * Asks before a patch carries mods the game will refuse or mis-load.
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
export function ModHealthLaunchGuard({ children, className }: ModHealthLaunchGuardProps) {
  const broken = useHealthVerdicts({ health: "broken", enabled: true });
  const openDrawer = useModHealthDrawerStore((s) => s.openDrawer);
  const requestRepair = useModHealthDrawerStore((s) => s.requestRepair);
  const navigate = useNavigate();
  const anchor = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<(() => void) | null>(null);

  /* Only what the game pays for holds a launch up. A mod that loads and plays
     is not a press to interrupt, and an ask over one teaches the reader to press
     through the ask that matters - the same reason a disabled mod does not ask.
     Per "Only what the game pays for asks" in docs/ux/MOD_HEALTH.md. */
  const asked = broken.filter((verdict) => alarmOf(verdict) !== "flagged");
  const repairable = asked.filter((verdict) => verdict.health === "repairable").length;

  const ask: GuardedLaunch = (launch) => {
    if (asked.length === 0) {
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
    /* The launch controls are in the app-wide status bar and the drawer is the
       library's, so the way out goes there first. The request outlives the
       navigation, and the drawer takes it when it mounts. */
    void navigate({ to: "/mods" });
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
    <div ref={anchor} className={twMerge("inline-flex", className)}>
      {children(ask)}
      <Popover.Root open={held !== null} onOpenChange={(next) => !next && setHeld(null)}>
        <Popover.Portal>
          <Popover.Positioner anchor={anchor} side="bottom" align="end" sideOffset={8}>
            <Popover.Popup className="w-80 p-3">
              <Popover.Title>Launch with {count(asked.length)}?</Popover.Title>
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
