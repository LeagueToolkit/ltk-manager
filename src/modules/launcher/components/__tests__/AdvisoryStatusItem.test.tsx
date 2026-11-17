// @vitest-environment happy-dom

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { ShownAdvisory } from "@/lib/tauri";
import { useAdvisories } from "@/modules/diagnostics";
import { commandNames } from "@/test/commandNames";
import { createMockInstalledMod } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { renderWithProviders } from "@/test/utils";

import { AdvisoryStatusItem } from "../AdvisoryStatusItem";

function advisory(over: Partial<ShownAdvisory> = {}): ShownAdvisory {
  return {
    code: "mod-missing",
    tier: null,
    subject: { kind: "mod", id: "aatrox" },
    patcherCode: null,
    source: "build",
    at: "2026-11-15T14:02:00Z",
    muted: false,
    ...over,
  };
}

function mockAdvisories(advisories: ShownAdvisory[]) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === commandNames.diagnostics.listAdvisories) {
      return Promise.resolve({ ok: true, value: advisories });
    }
    if (cmd === commandNames.library.getInstalledMods) {
      return Promise.resolve({
        ok: true,
        value: [createMockInstalledMod({ id: "aatrox", displayName: "Aatrox Justicar" })],
      });
    }
    if (cmd === commandNames.patcher.getPatcherStatus) {
      return Promise.resolve({ ok: true, value: { running: false, phase: "idle", session: null } });
    }
    return Promise.resolve({ ok: true, value: null });
  });
}

/** Reports when the advisory list has loaded, so an absence can be asserted. */
function Probe() {
  const { isSuccess } = useAdvisories();
  return <span data-testid={isSuccess ? "advisories-ready" : "advisories-pending"} />;
}

function renderItem() {
  return renderWithProviders(
    <>
      <Probe />
      <AdvisoryStatusItem />
    </>,
  );
}

describe("AdvisoryStatusItem", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders nothing if every advisory is muted", async () => {
    mockAdvisories([advisory({ muted: true })]);
    renderItem();

    await screen.findByTestId("advisories-ready");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("counts the mods that were not applied, without the muted ones", async () => {
    mockAdvisories([
      advisory(),
      advisory({ subject: { kind: "mod", id: "gone" } }),
      advisory({ subject: { kind: "mod", id: "muted" }, muted: true }),
    ]);
    renderItem();

    expect(
      await screen.findByRole("button", { name: "2 mods were not applied" }),
    ).toBeInTheDocument();
  });

  it("lists each advisory with its subject, its sentence and the code of the patcher", async () => {
    mockAdvisories([
      advisory(),
      advisory({
        code: "overlay-refused",
        tier: "integrity",
        subject: null,
        patcherCode: "VRF00000008",
        source: "game",
      }),
    ]);
    renderItem();

    await userEvent.click(await screen.findByRole("button", { name: "1 mod was not applied" }));

    const [missing, refused] = await screen.findAllByRole("listitem");
    expect(within(missing!).getByText("Aatrox Justicar")).toBeInTheDocument();
    expect(
      within(missing!).getByText("The mod is in the profile and not in the library."),
    ).toBeInTheDocument();
    expect(within(refused!).getByText("VRF00000008")).toBeInTheDocument();
    expect(within(refused!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("mutes the code of a row for its mod", async () => {
    mockAdvisories([advisory()]);
    renderItem();

    await userEvent.click(await screen.findByRole("button", { name: "1 mod was not applied" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Do not show again for this mod" }),
    );

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.diagnostics.muteAdvisory, {
        code: "mod-missing",
        modId: "aatrox",
      }),
    );
  });
});
