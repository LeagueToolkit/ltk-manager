// @vitest-environment happy-dom

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ForcibleMapSkin, MapDecoration, Settings } from "@/lib/tauri";

import { BuiltinModsSection } from "../BuiltinModsSection";
import { freshSettings, renderSettings } from "./fixtures";

const SKINS: ForcibleMapSkin[] = [
  { name: "Bloom", maps: ["Map11.wad.client", "Map12.wad.client"] },
  { name: "Sodapop_SRS", maps: ["Map11.wad.client"] },
];

function withMapSkin(mapSkin: Settings["builtinMods"]["mapSkin"], forcedMapSkin = ""): Settings {
  const settings = freshSettings();
  return {
    ...settings,
    leaguePath: "C:/Riot Games/League of Legends",
    builtinMods: { ...settings.builtinMods, mapSkin, forcedMapSkin },
  };
}

const DECORATIONS: MapDecoration[] = [
  { mutator: "MSITrophy", maps: ["Map11.wad.client"] },
  { mutator: "SR_Hall_Of_Legends", maps: ["Map11.wad.client"] },
];

function renderSection(settings: Settings, onSave = vi.fn()) {
  renderSettings(<BuiltinModsSection settings={settings} onSave={onSave} />, {
    settings,
    answers: { list_forcible_map_skins: SKINS, list_map_decorations: DECORATIONS },
  });
  return onSave;
}

describe("BuiltinModsSection map skin", () => {
  it("saves the mode the reader picks", async () => {
    const settings = withMapSkin("game");
    const onSave = renderSection(settings);

    const modes = screen.getByRole("group", { name: "Map skin" });
    await userEvent.click(within(modes).getByText("Classic"));

    expect(onSave).toHaveBeenCalledWith({
      ...settings,
      builtinMods: { ...settings.builtinMods, mapSkin: "classic" },
    });
  });

  it("offers the skin picker only once a chosen skin is the mode", () => {
    renderSection(withMapSkin("classic", "Bloom"));

    expect(screen.queryByText("Chosen map skin")).not.toBeInTheDocument();
  });

  it("describes what the mode it holds does", () => {
    renderSection(withMapSkin("classic"));

    expect(screen.getByText("Event games show the normal map")).toBeInTheDocument();
  });

  it("finds a skin by the map it covers and saves it", async () => {
    const settings = withMapSkin("forced");
    const onSave = renderSection(settings);

    const search = await screen.findByRole("combobox", { name: "Chosen map skin" });
    await waitFor(() => expect(search).toBeEnabled());
    await userEvent.type(search, "abyss");

    expect(await screen.findByRole("option", { name: /Bloom/ })).toHaveTextContent("Howling Abyss");
    expect(screen.queryByRole("option", { name: /Sodapop_SRS/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: /Bloom/ }));

    expect(onSave).toHaveBeenCalledWith({
      ...settings,
      builtinMods: { ...settings.builtinMods, forcedMapSkin: "Bloom" },
    });
  });

  it("says nothing changes until a skin is chosen", () => {
    renderSection(withMapSkin("forced"));

    expect(screen.getByText("Nothing changes until a skin is chosen")).toBeInTheDocument();
  });

  it("warns about a remembered skin the install no longer lists", async () => {
    renderSection(withMapSkin("forced", "Retired_SRS"));

    expect(
      await screen.findByText("Retired_SRS is not in this install, so games keep their own skin"),
    ).toBeInTheDocument();
  });

  it("asks for the League path before it can list skins", () => {
    const settings = { ...withMapSkin("forced"), leaguePath: null };
    renderSection(settings);

    expect(screen.getByText("Set the League path to list the map skins")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Chosen map skin" })).toBeDisabled();
  });
});

describe("BuiltinModsSection map decorations", () => {
  function withDecorations(mapDecorations: Settings["builtinMods"]["mapDecorations"]): Settings {
    const settings = withMapSkin("game");
    return { ...settings, builtinMods: { ...settings.builtinMods, mapDecorations } };
  }

  it("lists each decoration by the name players know it by", async () => {
    renderSection(withDecorations({}));

    expect(await screen.findByRole("group", { name: "Hall of Legends" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "MSI winner effects" })).toBeInTheDocument();
  });

  it("saves a decoration forced off", async () => {
    const settings = withDecorations({});
    const onSave = renderSection(settings);

    const modes = await screen.findByRole("group", { name: "Hall of Legends" });
    await userEvent.click(within(modes).getByText("Hidden"));

    expect(onSave).toHaveBeenCalledWith({
      ...settings,
      builtinMods: { ...settings.builtinMods, mapDecorations: { SR_Hall_Of_Legends: "hide" } },
    });
  });

  it("drops a decoration set back to the game", async () => {
    const settings = withDecorations({ SR_Hall_Of_Legends: "hide", MSITrophy: "show" });
    const onSave = renderSection(settings);

    const modes = await screen.findByRole("group", { name: "Hall of Legends" });
    await userEvent.click(within(modes).getByText("Game"));

    expect(onSave).toHaveBeenCalledWith({
      ...settings,
      builtinMods: { ...settings.builtinMods, mapDecorations: { MSITrophy: "show" } },
    });
  });
});
