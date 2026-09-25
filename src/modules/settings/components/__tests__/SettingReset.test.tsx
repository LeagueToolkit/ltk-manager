// @vitest-environment happy-dom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/mocks/tauri";

import { SettingGroup } from "../SettingGroup";
import { SettingRow } from "../SettingRow";
import { renderSettings, savedSettings } from "./fixtures";

function Startup() {
  return (
    <SettingGroup id="general.startup" title="Startup">
      <SettingRow setting="autoRun" control={<input type="checkbox" />} />
      <SettingRow setting="minimizeToTray" control={<input type="checkbox" />} />
      <SettingRow
        setting="leaguePath"
        layout="stacked"
        control={<input aria-label="Installation path" />}
      />
    </SettingGroup>
  );
}

const RESET_GROUP = /Reset \d+ changed settings in this group/;

function saveCount() {
  return mockInvoke.mock.calls.filter(([command]) => command === "save_settings").length;
}

describe("the gear", () => {
  /* Every row the index carries gets one, because an id is worth copying whether
     or not the value behind it can be put back. */
  it("belongs to every addressable row", () => {
    renderSettings(<Startup />);

    expect(screen.getAllByLabelText(/^Actions for /)).toHaveLength(3);
  });

  it("offers no reset on a row whose value is never put back", async () => {
    const user = userEvent.setup();
    renderSettings(<Startup />);

    await user.click(screen.getByLabelText("Actions for Installation path"));

    expect(await screen.findByRole("menuitem", { name: "Copy setting ID" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reset setting" })).not.toBeInTheDocument();
  });

  it("offers a reset only while the row is off its default", async () => {
    const user = userEvent.setup();
    renderSettings(<Startup />, { settings: { autoRun: true } });

    await user.click(screen.getByLabelText("Actions for Auto run"));
    expect(await screen.findByRole("menuitem", { name: "Reset setting" })).not.toHaveAttribute(
      "data-disabled",
    );
    await user.keyboard("{Escape}");

    await user.click(screen.getByLabelText("Actions for Minimize to system tray"));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Reset setting" })).toHaveAttribute(
        "data-disabled",
      ),
    );
  });

  it("says what a reset would put back", async () => {
    const user = userEvent.setup();
    renderSettings(<Startup />, { settings: { autoRun: true } });

    await user.click(screen.getByLabelText("Actions for Auto run"));

    expect(await screen.findByText("Default: Off")).toBeInTheDocument();
  });

  it("puts the row back", async () => {
    const user = userEvent.setup();
    renderSettings(<Startup />, { settings: { autoRun: true } });

    await user.click(screen.getByLabelText("Actions for Auto run"));
    await user.click(await screen.findByRole("menuitem", { name: "Reset setting" }));

    await waitFor(() => expect(saveCount()).toBe(1));
    expect(savedSettings().autoRun).toBe(false);
  });

  it("puts a built-in mod back inside its group", async () => {
    const user = userEvent.setup();
    renderSettings(
      <SettingRow setting="builtinMods.defaultWardSkins" control={<input type="checkbox" />} />,
      {
        settings: {
          builtinMods: {
            defaultWardSkins: true,
            baseSkins: "allChampions",
            mapSkin: "forced",
            forcedMapSkin: "Sodapop_SRS",
            mapDecorations: { MSITrophy: "hide" },
          },
        },
      },
    );

    await user.click(screen.getByLabelText("Actions for Default ward skins"));
    await user.click(await screen.findByRole("menuitem", { name: "Reset setting" }));

    await waitFor(() => expect(saveCount()).toBe(1));
    expect(savedSettings().builtinMods).toEqual({
      defaultWardSkins: false,
      baseSkins: "allChampions",
      mapSkin: "forced",
      forcedMapSkin: "Sodapop_SRS",
      mapDecorations: { MSITrophy: "hide" },
    });
  });

  it("copies the public id rather than the key the row reads", async () => {
    const user = userEvent.setup();
    renderSettings(<Startup />);

    await user.click(screen.getByLabelText("Actions for Auto run"));
    await user.click(await screen.findByRole("menuitem", { name: "Copy setting ID" }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("general.autoRun"));
  });

  it("copies a link the app can be opened on", async () => {
    const user = userEvent.setup();
    renderSettings(<Startup />);

    await user.click(screen.getByLabelText("Actions for Auto run"));
    await user.click(await screen.findByRole("menuitem", { name: "Copy link to setting" }));

    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe("ltk://settings?focus=general.autoRun"),
    );
  });
});

describe("the group reset", () => {
  /* One changed row is a gear away, so a second control for it would say the
     same thing twice. */
  it("stays away until a second row has changed", () => {
    renderSettings(<Startup />, { settings: { autoRun: true } });

    expect(screen.queryByRole("button", { name: RESET_GROUP })).not.toBeInTheDocument();
  });

  it("appears once two rows have changed, and counts them", async () => {
    renderSettings(<Startup />, { settings: { autoRun: true, minimizeToTray: false } });

    expect(
      await screen.findByRole("button", { name: "Reset 2 changed settings in this group" }),
    ).toBeInTheDocument();
  });

  it("writes every changed row in a single save", async () => {
    const user = userEvent.setup();
    renderSettings(<Startup />, { settings: { autoRun: true, minimizeToTray: false } });

    await user.click(await screen.findByRole("button", { name: RESET_GROUP }));

    await waitFor(() => expect(saveCount()).toBe(1));
    expect(savedSettings().autoRun).toBe(false);
    expect(savedSettings().minimizeToTray).toBe(true);
  });

  it("undoes only the keys it wrote", async () => {
    const user = userEvent.setup();
    renderSettings(<Startup />, { settings: { autoRun: true, minimizeToTray: false } });

    await user.click(await screen.findByRole("button", { name: RESET_GROUP }));
    await waitFor(() => expect(saveCount()).toBe(1));

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(saveCount()).toBe(2));
    expect(savedSettings(1).autoRun).toBe(true);
    expect(savedSettings(1).minimizeToTray).toBe(false);
  });
});
