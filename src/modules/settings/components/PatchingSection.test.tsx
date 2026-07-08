import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { api, type PlatformSupport, type Settings } from "@/lib/tauri";

import { PatchingSection } from "./PatchingSection";

const mocks = vi.hoisted(() => ({
  usePlatformSupport: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/hooks", () => ({
  usePlatformSupport: mocks.usePlatformSupport,
}));

vi.mock("@/modules/settings/api", () => ({
  useDetectLeagueRunAsAdmin: () => ({ data: false }),
}));

vi.mock("@/modules/patcher", () => ({
  usePatcherStatus: () => ({ data: { running: false } }),
  useRebuildOverlay: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components")>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("./WadBlocklistEditor", () => ({
  WadBlocklistEditor: () => null,
}));

function platform(patcher: Partial<PlatformSupport["patcher"]> = {}): PlatformSupport {
  return {
    os: "macos",
    architecture: "aarch64",
    patcher: {
      supported: true,
      ready: true,
      reason: "Administrator approval is requested per session",
      requiresSetup: false,
      permissionRequired: true,
      helperVersion: "1.9.0",
      ...patcher,
    },
    hotkeys: {
      supported: true,
      accessibilityPermissionRequired: false,
      reason: null,
    },
  };
}

function mockPlatform(data: PlatformSupport, isFetching = false) {
  mocks.usePlatformSupport.mockReturnValue({
    data,
    isFetching,
    refetch: mocks.refetch,
  });
}

const settings = {
  leaguePath: "/Applications/League of Legends.app",
  patchTft: true,
  blockScriptsWad: true,
} as Settings;

describe("PatchingSection macOS states", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.refetch.mockReset();
    mocks.usePlatformSupport.mockReset();
  });

  it("shows setup-required state and allows helper recheck without a League path", async () => {
    mockPlatform(
      platform({
        ready: false,
        requiresSetup: true,
        reason: "Native helper is missing",
        helperVersion: null,
      }),
    );
    render(<PatchingSection settings={{ ...settings, leaguePath: null }} onSave={vi.fn()} />);

    expect(screen.getByText("Native helper missing")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Check helper again" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("shows ready and updating states", () => {
    mockPlatform(platform(), true);
    render(<PatchingSection settings={settings} onSave={vi.fn()} />);

    expect(screen.getByText("Native helper ready")).toBeInTheDocument();
    expect(screen.getByText("Helper version 1.9.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check game compatibility" })).toBeDisabled();
  });

  it("shows an incompatible dry-scan result", async () => {
    mockPlatform(platform());
    vi.spyOn(api, "preflightPatcher").mockResolvedValue({
      ok: true,
      value: {
        compatible: false,
        backend: "macos-arm64-helper",
        architecture: "arm64",
        signature: null,
        reason: "No unique signature match",
      },
    });
    render(<PatchingSection settings={settings} onSave={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Check game compatibility" }));
    expect(await screen.findByText("No unique signature match")).toBeInTheDocument();
  });
});
