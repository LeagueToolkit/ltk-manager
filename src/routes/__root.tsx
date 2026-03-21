import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { usePageTransition, useReducedMotion } from "@/hooks";
import { ProtocolInstallDialog, useDeepLinkListener } from "@/modules/deep-link";
import { useLibraryWatcher } from "@/modules/library";
import { StatusBar } from "@/modules/patcher";
import { useAppInfo, useCheckSetupRequired } from "@/modules/settings";
import { DevConsole, TitleBar, useDevLogStream } from "@/modules/shell";
import { UpdateNotification, useUpdateCheck } from "@/modules/updater";
import { useDisplayStore } from "@/stores";

function RootLayout() {
  const { data: appInfo } = useAppInfo();
  useUpdateCheck({ checkOnMount: true, delayMs: 3000 });
  const navigate = useNavigate();
  const location = useLocation();

  const { data: setupRequired, isLoading: isCheckingSetup } = useCheckSetupRequired();

  const density = useDisplayStore((s) => s.density);
  const isReducedMotion = useReducedMotion();
  const pageTransition = usePageTransition();

  useDevLogStream();
  useDeepLinkListener();
  useLibraryWatcher();

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

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
      <div className="flex h-screen items-center justify-center bg-linear-to-br from-surface-900 via-surface-800 to-surface-900">
        <Loader2 className="h-6 w-6 animate-spin text-surface-400" />
      </div>
    );
  }

  return (
    <div className="root flex h-screen flex-col bg-surface-900">
      <TitleBar appInfo={appInfo} />
      <main className="relative flex-1 overflow-hidden">
        <UpdateNotification />
        <div
          className={`h-full ${pageTransition.className ?? ""}`}
          onAnimationEnd={pageTransition.onAnimationEnd}
        >
          <Outlet />
        </div>
      </main>
      <StatusBar />
      <ProtocolInstallDialog />
      {import.meta.env.DEV && <DevConsole />}
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
