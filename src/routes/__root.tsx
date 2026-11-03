import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components";
import { useOverscrollSpring, useReducedMotion, useZoomHotkeys } from "@/hooks";
import {
  loadMonoFace,
  loadSansFace,
  monoStack,
  sansStack,
  sansWeights,
  WEIGHT_TIERS,
} from "@/lib/fonts";
import type { OpenOn } from "@/lib/tauri";
import {
  InstallListDialogLazy,
  ProtocolInstallDialogLazy,
  useDeepLinkListener,
} from "@/modules/deep-link";
import { useCleanGameWatch, useIncidentListeners } from "@/modules/diagnostics";
import { openKeySheet, useKeys } from "@/modules/keys";
import {
  InstallMismatchDialog,
  SessionBar,
  useInstallMismatchWatch,
  useLeagueSession,
} from "@/modules/launcher";
import {
  LibraryMigrationDialog,
  ModHealthSweepListener,
  useLibraryWatcher,
  useModStorageToast,
  useOpenedFilesListener,
  WadScanFailedDialog,
} from "@/modules/library";
import {
  PatcherEventListeners,
  useClearStoppingOnIdle,
  useClearTestingProjectsOnIdle,
} from "@/modules/patcher";
import {
  DiagnosticsNoticeDialog,
  useAppInfo,
  useCheckSetupRequired,
  useSettings,
} from "@/modules/settings";
import {
  DevConsoleLazy,
  KeySheet,
  TitleBar,
  useAutoStartPatcher,
  useDevLogStream,
} from "@/modules/shell";
import { UpdateNotificationLazy, useUpdateCheck } from "@/modules/updater";
import { useDisplayStore, useSearchObjects, useUpdaterFoundAtLaunch } from "@/stores";

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
  const { data: settings } = useSettings();
  useUpdateCheck({ autoDownload: settings?.autoDownloadUpdates === true });
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
  useOpenedFilesListener();
  useLibraryWatcher();
  useModStorageToast();
  useAutoStartPatcher();
  useClearTestingProjectsOnIdle();
  useClearStoppingOnIdle();
  useIncidentListeners();
  useCleanGameWatch();
  useLeagueSession();
  useInstallMismatchWatch();
  useOverscrollSpring();
  useZoomHotkeys();

  /* Mounted for the rest of the session once the Workshop has been open with the
     switch on, since the lifecycle drops the index when the switch goes off and
     cannot do that unmounted. */
  const searchObjects = useSearchObjects();
  const inWorkshop = location.pathname.startsWith("/workshop");
  const [tracksObjectIndex, setTracksObjectIndex] = useState(false);
  useEffect(() => {
    if (searchObjects && inWorkshop) setTracksObjectIndex(true);
  }, [inWorkshop, searchObjects]);

  const updateAtLaunch = useUpdaterFoundAtLaunch();

  useEffect(() => {
    if (updateAtLaunch && settings?.startInTrayUnlessUpdate) {
      void getCurrentWindow().show();
    }
  }, [updateAtLaunch, settings?.startInTrayUnlessUpdate]);

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

  useKeys("app", {
    "app.home": () => void navigate({ to: "/" }),
    "app.library": () => void navigate({ to: "/mods" }),
    "app.workshop": () => void navigate({ to: "/workshop" }),
    "app.diagnostics": () => void navigate({ to: "/diagnostics", search: { tab: "games" } }),
    "app.settings": () => void navigate({ to: "/settings" }),
    "app.gallery": () => void navigate({ to: "/gallery" }),
    "app.keys": () => openKeySheet(),
  });

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
        <Spinner />
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
      <DiagnosticsNoticeDialog />
      <KeySheet />
      <Suspense fallback={null}>
        <ProtocolInstallDialogLazy />
        <InstallListDialogLazy />
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
