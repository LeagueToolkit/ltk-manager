// @vitest-environment happy-dom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AppError,
  DeepLinkInstallListRequest,
  InstallList,
  InstallListPlan,
  InstallListReport,
  Settings,
} from "@/lib/tauri";
import { useDialogQueueStore } from "@/stores";
import { commandNames } from "@/test/commandNames";
import { createMockInstalledMod, createMockProfile, createMockSettings } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { renderWithProviders } from "@/test/utils";

import { useInstallListStore } from "../../state";
import { InstallListDialog } from "../InstallListDialog";

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const MANIFEST_URL = "https://runeforge.dev/api/collections/5a00/install-list?sig=abc";

function item(id: string, name: string, version = "v1.0.0") {
  return {
    id,
    name,
    author: "frostforge",
    version,
    pageUrl: null,
    download: {
      method: "POST" as const,
      url: `https://runeforge.dev/api/mods/${id}/releases/1/download-link`,
    },
  };
}

const list: InstallList = {
  name: "Clean ADC kit",
  author: "ezreal_main",
  source: "Runeforge",
  pageUrl: "https://runeforge.dev/collections/5a00",
  items: [item("a", "Necron Kalista"), item("b", "Ork Jinx"), item("c", "Marine Caitlyn")],
};

const kalista = createMockInstalledMod({
  id: "mod-a",
  name: "necron-kalista",
  displayName: "Necron Kalista",
  origin: { source: "Runeforge", id: "a", version: "v1.0.0" },
});

function report(over: Partial<InstallListReport> = {}): InstallListReport {
  return {
    installed: [],
    updated: [],
    alreadyInstalled: [],
    failed: [],
    cancelled: false,
    profile: createMockProfile({ name: "Default" }),
    ...over,
  };
}

const world = {
  settings: createMockSettings({ trustedDomains: ["runeforge.dev"] }),
  mods: [kalista],
  report: report(),
};

function answer(command: string): { ok: true; value: unknown } | { ok: false; error: AppError } {
  switch (command) {
    case commandNames.settings.getSettings:
      return { ok: true, value: world.settings };
    case commandNames.settings.saveSettings:
      return { ok: true, value: null };
    case commandNames.library.getInstalledMods:
      return { ok: true, value: world.mods };
    case commandNames.library.getActiveModProfile:
      return { ok: true, value: createMockProfile({ name: "Default" }) };
    case commandNames.links.deepLinkInstallListFetch:
      return { ok: true, value: list };
    case commandNames.links.deepLinkInstallList:
      return { ok: true, value: world.report };
    default:
      return { ok: true, value: null };
  }
}

function calls(command: string) {
  return mockInvoke.mock.calls.filter(([name]) => name === command);
}

function plans(): InstallListPlan[] {
  return calls(commandNames.links.deepLinkInstallList).map(
    ([, args]) => (args as { plan: InstallListPlan }).plan,
  );
}

function request(over: Partial<DeepLinkInstallListRequest> = {}): DeepLinkInstallListRequest {
  return { url: MANIFEST_URL, source: "Runeforge", untrustedDomain: null, ...over };
}

describe("InstallListDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((command: string) => Promise.resolve(answer(command)));
    world.settings = createMockSettings({ trustedDomains: ["runeforge.dev"] });
    world.mods = [kalista];
    world.report = report();
    useInstallListStore.getState().reset();
    useDialogQueueStore.setState({ current: null, claims: [] });
  });

  it("reads the list and offers every mod the library does not hold at its version", async () => {
    useInstallListStore.getState().setRequest(request());
    renderWithProviders(<InstallListDialog />);

    expect(await screen.findByText("Clean ADC kit")).toBeVisible();
    expect(screen.getByRole("button", { name: "Install 2" })).toBeVisible();
    expect(screen.getByText("Installed")).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Necron Kalista" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Ork Jinx" })).toBeVisible();
  });

  it("installs the checked items, in the list's order, into the active profile", async () => {
    useInstallListStore.getState().setRequest(request());
    renderWithProviders(<InstallListDialog />);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Ork Jinx" }));
    await userEvent.click(screen.getByRole("button", { name: "Install 1" }));

    await waitFor(() => expect(plans()).toHaveLength(1));
    const [plan] = plans();
    expect(plan.manifestUrl).toBe(MANIFEST_URL);
    expect(plan.source).toBe("Runeforge");
    expect(plan.items.map((i) => i.id)).toEqual(["c"]);
    expect(plan.profile).toEqual({ kind: "active" });
  });

  it("asks for a new profile named after the list when the reader picks one", async () => {
    useInstallListStore.getState().setRequest(request());
    renderWithProviders(<InstallListDialog />);

    await userEvent.click(await screen.findByRole("radio", { name: /New profile/ }));
    await userEvent.click(screen.getByRole("button", { name: "Install 2" }));

    await waitFor(() => expect(plans()).toHaveLength(1));
    expect(plans()[0].profile).toEqual({ kind: "new", name: "Clean ADC kit" });
  });

  it("reads nothing from an untrusted domain until the reader trusts it", async () => {
    useInstallListStore.getState().setRequest(request({ untrustedDomain: "runeforge.dev" }));
    world.settings = createMockSettings({ trustedDomains: ["divineskins.gg"] });
    renderWithProviders(<InstallListDialog />);

    expect(await screen.findByText("runeforge.dev is not a trusted provider")).toBeVisible();
    expect(calls(commandNames.links.deepLinkInstallListFetch)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /Trust and continue/ }));

    const [[, saved]] = calls(commandNames.settings.saveSettings) as [
      [string, { settings: Settings }],
    ];
    expect(saved.settings.trustedDomains).toEqual(["divineskins.gg", "runeforge.dev"]);
  });

  it("reports what the run did and retries only the failed items", async () => {
    world.report = report({
      installed: [{ itemId: "b", mod: createMockInstalledMod({ id: "mod-b" }) }],
      failed: [{ itemId: "c", error: { code: "DOWNLOAD", error: { kind: "UNAVAILABLE" } } }],
    });
    useInstallListStore.getState().setRequest(request());
    renderWithProviders(<InstallListDialog />);

    await userEvent.click(await screen.findByRole("button", { name: "Install 2" }));

    expect(
      await screen.findByText(/1 installed, 0 updated, 0 already there, 1 failed/),
    ).toBeVisible();
    expect(screen.getByText("This mod is not available to download")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Retry failed" }));

    await waitFor(() => expect(plans()).toHaveLength(2));
    expect(plans()[1].items.map((i) => i.id)).toEqual(["c"]);
    expect(plans()[1].profile).toEqual({ kind: "active" });
  });
});
