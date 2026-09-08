import { SpinnerGapIcon } from "@phosphor-icons/react";
import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import {
  useOverscrollSpring,
  useReducedMotion,
  useSurfaceLinkedBinWarning,
  useZoomHotkeys,
} from "@/hooks";
import {
  loadMonoFace,
  loadSansFace,
  monoStack,
  sansStack,
  sansWeights,
  WEIGHT_TIERS,
} from "@/lib/fonts";
import type { OpenOn } from "@/lib/tauri";
import { ProtocolInstallDialogLazy, useDeepLinkListener } from "@/modules/deep-link";
import { useCleanGameWatch, useIncidentListeners } from "@/modules/diagnostics";
import {
  InstallMismatchDialog,
  SessionBar,
  useInstallMismatchWatch,
  useLeagueSession,
} from "@/modules/launcher";
import {
  LibraryMigrationDialog,
  LinkedBinWarningDialog,
  ModHealthSweepListener,
  useLibraryWatcher,
  useModStorageToast,
  WadScanFailedDialog,
} from "@/modules/library";
import {
  PatcherEventListeners,
  useClearStoppingOnIdle,
  useClearTestingProjectsOnIdle,
} from "@/modules/patcher";
import { useAppInfo, useCheckSetupRequired, useSettings } from "@/modules/settings";
import { DevConsoleLazy, TitleBar, useAutoStartPatcher, useDevLogStream } from "@/modules/shell";
import { UpdateNotificationLazy, useUpdateCheck } from "@/modules/updater";
import { useDisplayStore, useSearchObjects, useUpdaterUpdate } from "@/stores";

/* Workshop is the largest module and the root mounts one lifecycle of it, so
   the import is dynamic and the bin editor stays off the boot path. */
const ObjectIndexLifecycle = lazy(() =>
  import("@/modules/workshop").then((m) => ({ default: m.ObjectIndexLifecycle })),
);

/** Where `Open on` sends a reader who arrives at `/`. Home is `/` itself. */
const LANDING_ROUTES: Partial<Record<OpenOn, "/mods" | "/workshop">> = {
  mods: "/mods",
  workshop: "/workshop",
};

/** `promise`, resolving either way, so a failed load still runs what follows it. */
function settled(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    (reason: unknown) => {
      console.error("Font face failed to load", reason);
    },
  );
}

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
  useInstallMismatchWatch();
  useOverscrollSpring();
  useZoomHotkeys();

  /* Mounted for the rest of the session once the switch has been on, since the
     lifecycle drops the index when it goes off and cannot do that unmounted. */
  const searchObjects = useSearchObjects();
  const [tracksObjectIndex, setTracksObjectIndex] = useState(searchObjects);
  useEffect(() => {
    if (searchObjects) setTracksObjectIndex(true);
  }, [searchObjects]);

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

  /* The family is applied after the face is registered, so a lazily loaded face
     never draws a frame in the fallback stack. A face whose chunk does not
     arrive is applied anyway and falls back, which reads better than a stale
     family the reader did not choose. */
  useEffect(() => {
    let current = true;
    void settled(loadSansFace(sansFont)).then(() => {
      if (!current) return;
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
    });
    return () => {
      current = false;
    };
  }, [sansFont]);

  useEffect(() => {
    let current = true;
    void settled(loadMonoFace(monoFont)).then(() => {
      if (!current) return;
      document.documentElement.style.setProperty("--face-mono", monoStack(monoFont));
    });
    return () => {
      current = false;
    };
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
  useHotkeys("ctrl+2", () => navigate({ to: "/mods" }), { preventDefault: true });
  useHotkeys("ctrl+3", () => navigate({ to: "/workshop" }), { preventDefault: true });
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

  /* Once, when the settings first arrive: a later save must not move a reader
     off the page they are on. The first-run redirect above wins, since it
     leaves `/` before this runs or sends the reader on from wherever this went. */
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !settings) return;
    landed.current = true;
    if (location.pathname !== "/") return;
    const landing = LANDING_ROUTES[settings.openOn];
    if (landing) navigate({ to: landing });
  }, [settings, navigate, location.pathname]);

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
        <Suspense fallback={null}>
          <UpdateNotificationLazy />
        </Suspense>
        <div className="h-full">
          <Outlet />
        </div>
      </main>
      <SessionBar />
      <PatcherEventListeners />
      <LibraryMigrationDialog />
      <ModHealthSweepListener />
      <WadScanFailedDialog />
      <InstallMismatchDialog />
      <LinkedBinWarningDialog />
      <Suspense fallback={null}>
        <ProtocolInstallDialogLazy />
        {import.meta.env.DEV && <DevConsoleLazy />}
      </Suspense>
      {/* Its own boundary: the workshop chunk is the slowest of these to arrive. */}
      <Suspense fallback={null}>{tracksObjectIndex && <ObjectIndexLifecycle />}</Suspense>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
