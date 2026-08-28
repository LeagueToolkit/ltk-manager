import { SpinnerGapIcon } from "@phosphor-icons/react";
import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import {
  useAutoStartPatcher,
  useOverscrollSpring,
  useReducedMotion,
  useSurfaceLinkedBinWarning,
  useZoomHotkeys,
} from "@/hooks";
import { monoStack, sansStack, sansWeights, WEIGHT_TIERS } from "@/lib/fonts";
import { ProtocolInstallDialog, useDeepLinkListener } from "@/modules/deep-link";
import { useCleanGameWatch, useIncidentListeners } from "@/modules/diagnostics";
import { SessionBar, useLeagueSession } from "@/modules/launcher";
import {
  LibraryMigrationDialog,
  ModHealthSweepListener,
  useLibraryWatcher,
  useModStorageToast,
} from "@/modules/library";
import {
  LinkedBinWarningDialog,
  PatcherEventListeners,
  useClearStoppingOnIdle,
  useClearTestingProjectsOnIdle,
  WadScanFailedDialog,
} from "@/modules/patcher";
import { useAppInfo, useCheckSetupRequired, useSettings } from "@/modules/settings";
import { DevConsole, TitleBar, useDevLogStream } from "@/modules/shell";
import { UpdateNotification, useUpdateCheck } from "@/modules/updater";
import { useDisplayStore, useUpdaterUpdate } from "@/stores";

function RootLayout() {
  const { data: appInfo } = useAppInfo();
  useUpdateCheck({ checkOnMount: true, delayMs: 3000 });
  const navigate = useNavigate();
  const location = useLocation();

  const { data: setupRequired, isLoading: isCheckingSetup } = useCheckSetupRequired();

  const zoomLevel = useDisplayStore((s) => s.zoomLevel);
  const cornerStyle = useDisplayStore((s) => s.cornerStyle);
  const sansFont = useDisplayStore((s) => s.sansFont);
  const monoFont = useDisplayStore((s) => s.monoFont);
  const surfaceTint = useDisplayStore((s) => s.surfaceTint);
  const cardScale = useDisplayStore((s) => s.cardScale);
  const scrollMode = useDisplayStore((s) => s.scrollMode);
  const scrollbarSize = useDisplayStore((s) => s.scrollbarSize);
  const isReducedMotion = useReducedMotion();

  useDevLogStream();
  useDeepLinkListener();
  useLibraryWatcher();
  useModStorageToast();
  useAutoStartPatcher();
  useSurfaceLinkedBinWarning();
  useClearTestingProjectsOnIdle();
  useClearStoppingOnIdle();
  useIncidentListeners();
  useCleanGameWatch();
  useLeagueSession();
  useOverscrollSpring();
  useZoomHotkeys();

  const update = useUpdaterUpdate();
  const { data: settings } = useSettings();

  useEffect(() => {
    if (update && settings?.startInTrayUnlessUpdate) {
      void getCurrentWindow().show();
    }
  }, [update, settings?.startInTrayUnlessUpdate]);

  useEffect(() => {
    document.documentElement.style.setProperty("--zoom-scale", String(zoomLevel / 100));
  }, [zoomLevel]);

  useEffect(() => {
    document.documentElement.dataset.corners = cornerStyle;
  }, [cornerStyle]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--face-sans", sansStack(sansFont));
    /* Every tier is written or cleared, so the face before this one leaves
       nothing of its own behind. */
    const weights = sansWeights(sansFont);
    for (const tier of WEIGHT_TIERS) {
      const weight = weights[tier];
      if (weight === undefined) root.style.removeProperty(`--weight-${tier}`);
      else root.style.setProperty(`--weight-${tier}`, String(weight));
    }
  }, [sansFont]);

  useEffect(() => {
    document.documentElement.style.setProperty("--face-mono", monoStack(monoFont));
  }, [monoFont]);

  useEffect(() => {
    document.documentElement.style.setProperty("--surface-tint", String(surfaceTint / 100));
  }, [surfaceTint]);

  useEffect(() => {
    document.documentElement.style.setProperty("--card-scale", String(cardScale / 100));
  }, [cardScale]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(isReducedMotion);
  }, [isReducedMotion]);

  useEffect(() => {
    document.documentElement.dataset.scrollMode = scrollMode;
  }, [scrollMode]);

  useEffect(() => {
    document.documentElement.dataset.scrollbars = scrollbarSize;
  }, [scrollbarSize]);

  useHotkeys("ctrl+1", () => navigate({ to: "/" }), { preventDefault: true });
  useHotkeys("ctrl+2", () => navigate({ to: "/workshop" }), { preventDefault: true });
  useHotkeys("ctrl+d", () => navigate({ to: "/diagnostics", search: { tab: "games" } }), {
    preventDefault: true,
  });
  useHotkeys("ctrl+,", () => navigate({ to: "/settings" }), { preventDefault: true });
  // Redirect to settings if setup is required
  useEffect(() => {
    if (setupRequired && location.pathname !== "/settings") {
      navigate({ to: "/settings", search: { firstRun: true } });
    }
  }, [setupRequired, navigate, location.pathname]);

  // Show loading state while checking setup
  if (isCheckingSetup) {
    return (
      <div className="flex h-screen items-center justify-center bg-linear-to-br from-surface-950 via-surface-900 to-surface-950">
        <SpinnerGapIcon className="h-6 w-6 animate-spin text-surface-400" />
      </div>
    );
  }

  return (
    <div className="root flex h-screen flex-col bg-surface-950">
      <TitleBar appInfo={appInfo} />
      <main className="relative flex-1 overflow-hidden">
        <UpdateNotification />
        <div className="h-full">
          <Outlet />
        </div>
      </main>
      <SessionBar />
      <PatcherEventListeners />
      <ProtocolInstallDialog />
      <LibraryMigrationDialog />
      <ModHealthSweepListener />
      <WadScanFailedDialog />
      <LinkedBinWarningDialog />
      {import.meta.env.DEV && <DevConsole />}
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
