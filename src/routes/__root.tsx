import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { useAutoStartPatcher, useReducedMotion, useSurfaceLinkedBinWarning } from "@/hooks";
import { ProtocolInstallDialog, useDeepLinkListener } from "@/modules/deep-link";
import { SessionBar } from "@/modules/launcher";
import { useLibraryWatcher } from "@/modules/library";
import {
  LinkedBinWarningDialog,
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
  const isReducedMotion = useReducedMotion();

  useDevLogStream();
  useDeepLinkListener();
  useLibraryWatcher();
  useAutoStartPatcher();
  useSurfaceLinkedBinWarning();
  useClearTestingProjectsOnIdle();
  useClearStoppingOnIdle();

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
    document.documentElement.dataset.reduceMotion = String(isReducedMotion);
  }, [isReducedMotion]);

  useHotkeys("ctrl+1", () => navigate({ to: "/" }), { preventDefault: true });
  useHotkeys("ctrl+2", () => navigate({ to: "/workshop" }), { preventDefault: true });
  useHotkeys("ctrl+,", () => navigate({ to: "/settings" }), { preventDefault: true });
  useHotkeys(
    "ctrl+f",
    () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
      input?.focus();
    },
    { preventDefault: true, enableOnFormTags: true },
  );

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
        <Loader2 className="h-6 w-6 animate-spin text-surface-400" />
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
      <ProtocolInstallDialog />
      <WadScanFailedDialog />
      <LinkedBinWarningDialog />
      {import.meta.env.DEV && <DevConsole />}
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
