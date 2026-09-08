import { create } from "zustand";

import type { DeepLinkInstallRequest, ProtocolInstallProgress } from "@/lib/tauri";

type InstallStatus = "idle" | "downloading" | "installing" | "complete" | "error";

interface DeepLinkStore {
  request: DeepLinkInstallRequest | null;
  status: InstallStatus;
  progress: ProtocolInstallProgress | null;
  error: string | null;
  setRequest: (request: DeepLinkInstallRequest) => void;
  setStatus: (status: InstallStatus) => void;
  setProgress: (progress: ProtocolInstallProgress) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const useDeepLinkStore = create<DeepLinkStore>((set) => ({
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
