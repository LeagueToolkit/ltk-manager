// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PatchStatus } from "@/lib/tauri";
import { commandNames } from "@/test/commandNames";
import { createMockSettings } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { settingsKeys } from "../../api/keys";
import { settingsMutations } from "../../api/mutations";
import { ComingPatchStatus, PatchStatusHint } from "../ComingPatchStatus";

const status: PatchStatus = {
  knownBuild: 8298620,
  knownPatch: "16.21",
  installedPatch: "16.17",
  installConfigured: true,
  waitingPatch: null,
};

describe("PatchStatusHint", () => {
  it("explains an idle setting even when newer tables exist", () => {
    render(<PatchStatusHint status={status} />);
    expect(screen.getByText(/Nothing is waiting/)).toHaveTextContent(
      "The manager knows patches up to 16.21. Your game is on 16.17.",
    );
  });

  it("disappears when a rule waits for an installed patch", () => {
    const { container } = render(<PatchStatusHint status={{ ...status, waitingPatch: "16.17" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("distinguishes an unconfigured install from unreadable metadata", () => {
    const { rerender } = render(
      <PatchStatusHint status={{ ...status, installedPatch: null, installConfigured: false }} />,
    );
    expect(screen.getByText(/No League install is configured/)).toBeInTheDocument();
    rerender(<PatchStatusHint status={{ ...status, installedPatch: null }} />);
    expect(screen.getByText(/The installed game version could not be read/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is waiting/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No League install is configured/)).not.toBeInTheDocument();
  });

  it("uses the content build when a new schema has no patch name", () => {
    render(<PatchStatusHint status={{ ...status, knownPatch: null }} />);
    expect(screen.getByText(/content builds up to 8298620/)).toBeInTheDocument();
  });
});

describe("ComingPatchStatus query", () => {
  function renderQuery() {
    const client = createTestQueryClient();
    const settings = createMockSettings({ leaguePath: "C:/League" });
    client.setQueryDefaults(settingsKeys.settings(), { staleTime: Infinity });
    client.setQueryData(settingsKeys.settings(), settings);
    const view = render(
      <QueryClientProvider client={client}>
        <ComingPatchStatus />
      </QueryClientProvider>,
    );
    return { client, settings, ...view };
  }

  it("shows no idle claim while loading or after a failed read", async () => {
    let reject!: (reason: Error) => void;
    mockInvoke.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { container, client } = renderQuery();
    expect(container).toBeEmptyDOMElement();
    await act(async () => reject(new Error("unavailable")));
    await waitFor(() =>
      expect(client.getQueryState(settingsKeys.patchStatus("C:/League"))?.status).toBe("error"),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("rereads patch information after the install path changes", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((command: string) => {
      expect(command).toBe(commandNames.settings.getPatchStatus);
      return Promise.resolve({ ok: true, value: status });
    });
    const { client, settings } = renderQuery();
    await screen.findByText(/Your game is on 16.17/);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await act(async () =>
      client.setQueryData(settingsKeys.settings(), { ...settings, leaguePath: "D:/League" }),
    );
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
  });

  it("refreshes an optimistic path query after the backend finishes saving", async () => {
    let installed = status;
    let finishSave!: () => void;
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((command: string) => {
      if (command === commandNames.settings.saveSettings) {
        return new Promise((resolve) => {
          finishSave = () => {
            installed = { ...status, installedPatch: "16.21" };
            resolve({ ok: true, value: null });
          };
        });
      }
      expect(command).toBe(commandNames.settings.getPatchStatus);
      return Promise.resolve({ ok: true, value: installed });
    });
    const { client, settings } = renderQuery();
    await screen.findByText(/Your game is on 16.17/);
    const mutation = client.getMutationCache().build(client, settingsMutations.save(client));
    let saved!: Promise<unknown>;
    await act(async () => {
      saved = mutation.execute({ ...settings, leaguePath: "D:/League" });
    });
    await waitFor(() =>
      expect(client.getQueryData(settingsKeys.patchStatus("D:/League"))).toEqual(status),
    );
    await act(async () => {
      finishSave();
      await saved;
    });
    await screen.findByText(/Your game is on 16.21/);
  });
});
