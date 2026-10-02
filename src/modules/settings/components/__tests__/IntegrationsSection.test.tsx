// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ConfirmHost, ToastProvider } from "@/components";
import type { IntegrationStatus } from "@/lib/tauri";
import { commandNames } from "@/test/commandNames";
import { createMockSettings } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { settingsKeys } from "../../api";
import { IntegrationsSection } from "../IntegrationsSection";

const absent: IntegrationStatus = {
  tool: "wadtools",
  supported: true,
  version: null,
  directory: null,
  needsRepair: false,
  pendingCleanup: false,
  menu: "absent",
  menuRequested: false,
  externalPaths: [],
  handlerPath: null,
  operation: null,
};

function show(status: Partial<IntegrationStatus> = {}, offline = false) {
  const client = createTestQueryClient();
  const settings = createMockSettings();
  client.setQueryData(settingsKeys.settings(), settings);
  client.setQueryData(settingsKeys.defaults(), settings);
  mockInvoke.mockImplementation((command: string) => {
    if (command === commandNames.app.integrationStatus)
      return Promise.resolve({ ok: true, value: [{ ...absent, ...status }] });
    if (command === commandNames.app.integrationRelease) {
      if (offline)
        return Promise.resolve({
          ok: false,
          error: { code: "INTEGRATION", error: { kind: "operation", detail: "offline" } },
        });
      return Promise.resolve({
        ok: true,
        value: {
          tag: "v0.5.7",
          url: "https://github.com/LeagueToolkit/wadtools/releases/tag/v0.5.7",
        },
      });
    }
    if (
      command === commandNames.settings.getSettings ||
      command === commandNames.settings.getDefaultSettings
    )
      return Promise.resolve({ ok: true, value: settings });
    return Promise.resolve({ ok: true, value: null });
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <IntegrationsSection />
        <ConfirmHost />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => mockInvoke.mockReset());

describe("IntegrationsSection", () => {
  it.each([
    ["wadtools", "Wad Tools"],
    ["tex-toolz", "Tex Tools"],
  ] as const)("copies a deep link to the %s integration", async (tool, name) => {
    const user = userEvent.setup();
    show({ tool });
    await user.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
    expect(screen.queryByRole("menuitem", { name: "Reset setting" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    expect(await screen.findByText("Copied link")).toBeVisible();
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe(
        `ltk://settings?focus=integrations.${tool}`,
      ),
    );
  });

  it("opens the same link menu by right-clicking the integration", async () => {
    const user = userEvent.setup();
    show();
    await user.pointer({
      target: await screen.findByRole("region", { name: "Wad Tools" }),
      keys: "[MouseRight]",
    });
    await user.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe(
        "ltk://settings?focus=integrations.wadtools",
      ),
    );
  });

  it("installs without menus when the initial option is cleared", async () => {
    show();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("checkbox", { name: "Enable context menus on installation" }),
    );
    await user.click(screen.getByRole("button", { name: "Install" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Install" }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.app.changeIntegration, {
        tool: "wadtools",
        action: "installOnly",
        conflicts: "preserve",
      }),
    );
  });

  it("keeps the installed version and removal action when release checks fail", async () => {
    show({ version: "v0.5.7", directory: "C:/tool" }, true);
    expect(await screen.findByText("v0.5.7")).toBeInTheDocument();
    expect(await screen.findByText(/Release information could not be checked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeEnabled();
  });

  it("does not remove files when uninstall confirmation is cancelled", async () => {
    show({ version: "v0.5.7" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Uninstall" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      mockInvoke.mock.calls.some(([command]) => command === commandNames.app.changeIntegration),
    ).toBe(false);
  });

  it("requires explicit replacement before changing another installation's menu", async () => {
    show({ version: "v0.5.7", menu: "external", externalPaths: ["C:/other/wadtools.exe"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Enable" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("C:/other/wadtools.exe")).toBeInTheDocument();
    expect(
      mockInvoke.mock.calls.some(([command]) => command === commandNames.app.changeIntegration),
    ).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Replace menus" }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.app.changeIntegration, {
        tool: "wadtools",
        action: "enableMenu",
        conflicts: "replace",
      }),
    );
  });

  it("reconstructs a running download and cancels only its operation id", async () => {
    show({
      operation: {
        id: "run-1",
        tool: "wadtools",
        stage: "downloading",
        downloaded: 5,
        total: 10,
        error: null,
      },
    });
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.app.cancelIntegrationDownload, {
        operationId: "run-1",
      }),
    );
  });

  it("shows the handler limitation and disables unsupported platform actions", async () => {
    show({ tool: "tex-toolz", supported: false });
    expect(await screen.findByRole("heading", { name: "Tex Tools" })).toBeInTheDocument();
    expect(screen.getByText(/It cannot be changed from Manager yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeDisabled();
  });

  it("offers the initial menu choice without an unavailable enable action", async () => {
    show({ menu: "external", externalPaths: ["C:/other/wadtools.exe"] });
    expect(await screen.findByRole("checkbox")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
    expect(screen.getByText("Registered by another installation")).toBeInTheDocument();
  });

  it("reveals full paths and combines equivalent Windows paths", async () => {
    show({
      version: "v0.5.7",
      directory: "C:/managed",
      externalPaths: ["C:/other/wadtools.exe", "C:\\other\\wadtools.exe", "D:/tools/wadtools.exe"],
    });
    expect(await screen.findByText("2 elsewhere")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wad Tools" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("C:/managed")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Locations/ }));
    const managed = await screen.findByRole("textbox", { name: "Manager" });
    expect(managed).toHaveValue("C:/managed");
    expect(managed).toHaveAttribute("readonly");
    expect(managed).toBeEnabled();
    expect(screen.getAllByDisplayValue("C:/other/wadtools.exe")).toHaveLength(1);
    const paths = within(screen.getByRole("list", { name: "Elsewhere" }));
    expect(paths.getAllByRole("listitem")).toHaveLength(2);
    expect(paths.getByDisplayValue("D:/tools/wadtools.exe")).toBeVisible();
    const managedPaths = screen.getByRole("list", { name: "Manager" });
    await userEvent.hover(managedPaths);
    await userEvent.click(
      within(managedPaths).getByRole("button", { name: "Open in file manager" }),
    );
    expect(mockInvoke).toHaveBeenCalledWith(commandNames.app.revealInExplorer, {
      path: "C:/managed",
    });
    const external = paths.getAllByRole("listitem")[1]!;
    await userEvent.hover(external);
    await userEvent.click(within(external).getByRole("button", { name: "Open in file manager" }));
    expect(mockInvoke).toHaveBeenCalledWith(commandNames.app.revealInExplorer, {
      path: "D:/tools/wadtools.exe",
    });
  });

  it("shows an indeterminate download when its total is zero", async () => {
    show({
      operation: {
        id: "run-1",
        tool: "wadtools",
        stage: "downloading",
        downloaded: 0,
        total: 0,
        error: null,
      },
    });
    expect(await screen.findByRole("progressbar", { name: "Downloading" })).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });
});
