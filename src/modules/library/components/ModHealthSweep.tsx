import { useEffect } from "react";

import { useLibrarySelectionStore, useModHealthDrawerStore } from "@/stores";

import { useModHealthStatus } from "../api";
import { ModHealthSweepDrawer } from "./ModHealthSweepDrawer";

/**
 * The mod health drawer, mounted where it can cover the grid it reports on.
 *
 * Per "The status bar item and the drawer" in docs/ux/MOD_HEALTH.md. What opens
 * it is a status bar cell in the app shell, so the two meet at
 * `useModHealthDrawerStore` rather than through the page between them.
 *
 * The unprompted open is raised here rather than from that cell, because here is
 * the only place that knows the drawer would be seen.
 */
export function ModHealthSweep() {
  const status = useModHealthStatus();
  const open = useModHealthDrawerStore((s) => s.open);
  const announce = useModHealthDrawerStore((s) => s.announce);
  const close = useModHealthDrawerStore((s) => s.close);
  const selectMode = useLibrarySelectionStore((s) => s.selectMode);
  const setHosted = useModHealthDrawerStore((s) => s.setHosted);

  // Select mode is one the user is holding open, and a panel over the grid they
  // are picking from would fight it.
  const hosting = status !== null && !selectMode;

  useEffect(() => {
    if (status) announce();
  }, [status, announce]);

  // Unconditional: this is where a drawer can be mounted, which is what the
  // cell needs to know. Whether one is showing right now is `open`, and select
  // mode withholding it does not make the cell a dead press - it holds the
  // count either way, and the drawer comes back when the mode ends.
  useEffect(() => {
    setHosted(true);
    return () => setHosted(false);
  }, [setHosted]);

  if (!hosting) return null;

  return <ModHealthSweepDrawer open={open} onClose={close} />;
}
