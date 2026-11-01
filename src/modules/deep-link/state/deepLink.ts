import { create } from "zustand";

import type { AppError, DeepLinkInstallRequest, ProtocolInstallProgress } from "@/lib/tauri";

export type InstallStatus =
  | "idle"
  | "downloading"
  | "installing"
  | "complete"
  | "updated"
  | "existing"
  | "error";

interface DeepLinkStore {
  request: DeepLinkInstallRequest | null;
  status: InstallStatus;
  progress: ProtocolInstallProgress | null;
  /** The failure of the last install, which the dialog describes. */
  error: AppError | null;
  setRequest: (request: DeepLinkInstallRequest) => void;
  setStatus: (status: InstallStatus) => void;
  setProgress: (progress: ProtocolInstallProgress) => void;
  setError: (error: AppError) => void;
  reset: () => void;
}

export const useDeepLinkStore = create<DeepLinkStore>()((set) => ({
  request: null,
  status: "idle",
  progress: null,
  error: null,
  setRequest: (request) => set({ request, status: "idle", error: null, progress: null }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error, status: "error" }),
  reset: () => set({ request: null, status: "idle", progress: null, error: null }),
}));
