import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import {
  api,
  type DeepLinkInstallListRequest,
  type DeepLinkInstallRequest,
  type DeepLinkSettingsRequest,
} from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";

import { useDeepLinkStore, useInstallListStore } from "../state";

export function useDeepLinkListener() {
  const navigate = useNavigate();

  const openSettings = useCallback(
    ({ focus }: DeepLinkSettingsRequest) => {
      void navigate({ to: "/settings", search: { focus } });
    },
    [navigate],
  );

  useTauriEvent<DeepLinkInstallRequest>("deep-link-install", (payload) => {
    useDeepLinkStore.getState().setRequest(payload);
  });

  useTauriEvent<DeepLinkInstallListRequest>("deep-link-install-list", (payload) => {
    useInstallListStore.getState().setRequest(payload);
  });

  useTauriEvent<DeepLinkSettingsRequest>("deep-link-settings", openSettings);

  /* A URL the app was launched with reaches the backend before this listener
     exists, so the link it could not send is asked for once, here. */
  useEffect(() => {
    void api.takePendingDeepLink().then((result) => {
      if (!result.ok || !result.value) return;
      const pending = result.value;
      if (pending.kind === "settings") {
        openSettings(pending);
        return;
      }
      if (pending.kind === "installList") {
        useInstallListStore.getState().setRequest(pending);
        return;
      }
      useDeepLinkStore.getState().setRequest(pending);
    });
  }, [openSettings]);
}
