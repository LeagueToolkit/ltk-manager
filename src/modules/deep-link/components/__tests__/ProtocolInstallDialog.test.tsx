// @vitest-environment happy-dom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeepLinkInstallRequest, Settings } from "@/lib/tauri";
import { useDialogQueueStore } from "@/stores";
import { commandNames } from "@/test/commandNames";
import { createMockSettings } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { renderWithProviders } from "@/test/utils";

import { useDeepLinkStore } from "../../state";
import { ProtocolInstallDialog } from "../ProtocolInstallDialog";

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const world = {
  settings: createMockSettings({ trustedDomains: ["runeforge.dev"] }),
};

function answer(command: string): unknown {
  switch (command) {
    case commandNames.settings.getSettings:
      return world.settings;
    case commandNames.settings.saveSettings:
      return null;
    case commandNames.links.deepLinkInstallMod:
      return { id: "a", name: "Zama Iroha Master Yi" };
    default:
      return null;
  }
}

function calls(command: string) {
  return mockInvoke.mock.calls.filter(([name]) => name === command);
}

function request(over: Partial<DeepLinkInstallRequest> = {}): DeepLinkInstallRequest {
  return {
    url: "https://ultrawidehud.lol/mods/yi.modpkg",
    name: "Zama Iroha Master Yi",
    author: "SkinMaker",
    source: "ultrawidehud.lol",
    untrustedDomain: null,
    ...over,
  };
}

describe("ProtocolInstallDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((command: string) =>
      Promise.resolve({ ok: true, value: answer(command) }),
    );
    world.settings = createMockSettings({ trustedDomains: ["runeforge.dev"] });
    useDeepLinkStore.getState().reset();
    useDialogQueueStore.setState({ current: null, claims: [] });
  });

  it("asks nothing about a domain the allowlist already covers", async () => {
    useDeepLinkStore.getState().setRequest(request());
    renderWithProviders(<ProtocolInstallDialog />);

    expect(await screen.findByRole("button", { name: "Install" })).toBeVisible();
    expect(screen.queryByText(/is not a trusted provider/)).toBeNull();
  });

  it("names the untrusted domain and offers the two answers instead of Install", async () => {
    useDeepLinkStore.getState().setRequest(request({ untrustedDomain: "ultrawidehud.lol" }));
    renderWithProviders(<ProtocolInstallDialog />);

    expect(await screen.findByText("ultrawidehud.lol is not a trusted provider")).toBeVisible();
    expect(screen.getByRole("button", { name: /Trust and install/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reject" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  /* The install command reads the same allowlist, so the save has to land first
     or the download races the gate it is meant to have passed. */
  it("saves the domain before it installs", async () => {
    useDeepLinkStore.getState().setRequest(request({ untrustedDomain: "ultrawidehud.lol" }));
    renderWithProviders(<ProtocolInstallDialog />);

    await userEvent.click(await screen.findByRole("button", { name: /Trust and install/ }));

    await waitFor(() => expect(calls(commandNames.links.deepLinkInstallMod)).toHaveLength(1));
    const [[, saved]] = calls(commandNames.settings.saveSettings) as [
      [string, { settings: Settings }],
    ];
    expect(saved.settings.trustedDomains).toEqual(["runeforge.dev", "ultrawidehud.lol"]);
    expect(
      mockInvoke.mock.calls.findIndex(([name]) => name === commandNames.settings.saveSettings),
    ).toBeLessThan(
      mockInvoke.mock.calls.findIndex(([name]) => name === commandNames.links.deepLinkInstallMod),
    );
  });

  it("installs nothing and drops the request when the reader rejects it", async () => {
    useDeepLinkStore.getState().setRequest(request({ untrustedDomain: "ultrawidehud.lol" }));
    renderWithProviders(<ProtocolInstallDialog />);

    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));

    expect(calls(commandNames.settings.saveSettings)).toHaveLength(0);
    expect(calls(commandNames.links.deepLinkInstallMod)).toHaveLength(0);
    expect(useDeepLinkStore.getState().request).toBeNull();
  });

  /* Trusting the domain in Settings while the dialog stands is the same news as
     trusting it here, and the marker the link arrived with cannot know it. */
  it("drops the band once the settings already hold the domain", async () => {
    world.settings = createMockSettings({
      trustedDomains: ["runeforge.dev", "ultrawidehud.lol"],
    });
    useDeepLinkStore.getState().setRequest(request({ untrustedDomain: "ultrawidehud.lol" }));
    renderWithProviders(<ProtocolInstallDialog />);

    expect(await screen.findByRole("button", { name: "Install" })).toBeVisible();
    expect(screen.queryByText(/is not a trusted provider/)).toBeNull();
  });
});
