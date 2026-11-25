import { describe, expect, it } from "vitest";

import type { BuiltinModSettings } from "@/lib/tauri";
import { createMockInking, createMockSettings } from "@/test/fixtures";

import {
  colorToRgb8,
  hasBuiltinMods,
  INKING_PRESETS,
  inkingStyle,
  missingChoices,
  rgb8ToColor,
  withDecoration,
} from "../builtinMods";

function withBuiltinMods(builtinMods: Partial<BuiltinModSettings>) {
  const defaults: BuiltinModSettings = {
    defaultWardSkins: false,
    baseSkins: "off",
    mapSkin: "game",
    forcedMapSkin: "",
    mapDecorations: {},
    characterInking: createMockInking(),
    loadingScreen: { enabled: false, assets: null },
  };
  return createMockSettings({ builtinMods: { ...defaults, ...builtinMods } as BuiltinModSettings });
}

describe("hasBuiltinMods", () => {
  it("counts default ward skins, which change the game alone", () => {
    expect(hasBuiltinMods(withBuiltinMods({ defaultWardSkins: true }))).toBe(true);
  });

  it("counts base skins for every champion, which change the game alone", () => {
    expect(hasBuiltinMods(withBuiltinMods({ baseSkins: "allChampions" }))).toBe(true);
  });

  it("leaves out base skins for modded champions, which only rework other mods", () => {
    expect(hasBuiltinMods(withBuiltinMods({ baseSkins: "moddedChampions" }))).toBe(false);
  });

  it("counts the classic map skin", () => {
    expect(hasBuiltinMods(withBuiltinMods({ mapSkin: "classic" }))).toBe(true);
  });

  it("counts a chosen map skin only once one is chosen", () => {
    expect(hasBuiltinMods(withBuiltinMods({ mapSkin: "forced", forcedMapSkin: "Bloom" }))).toBe(
      true,
    );
    expect(hasBuiltinMods(withBuiltinMods({ mapSkin: "forced" }))).toBe(false);
  });

  it("leaves out the game's own map skin, however a chosen one is remembered", () => {
    expect(hasBuiltinMods(withBuiltinMods({ mapSkin: "game", forcedMapSkin: "Bloom" }))).toBe(
      false,
    );
  });

  it("counts a map decoration forced off or on", () => {
    expect(
      hasBuiltinMods(withBuiltinMods({ mapDecorations: { SR_Hall_Of_Legends: "hide" } })),
    ).toBe(true);
    expect(hasBuiltinMods(withBuiltinMods({ mapDecorations: {} }))).toBe(false);
  });

  it("counts character inking only while it is on", () => {
    expect(
      hasBuiltinMods(withBuiltinMods({ characterInking: createMockInking({ enabled: true }) })),
    ).toBe(true);
    expect(hasBuiltinMods(withBuiltinMods({ characterInking: createMockInking() }))).toBe(false);
  });

  it("counts custom loading screen only while enabled and an asset is chosen", () => {
    expect(
      hasBuiltinMods(withBuiltinMods({ loadingScreen: { enabled: true, assets: "bg.png" } })),
    ).toBe(true);
    expect(
      hasBuiltinMods(withBuiltinMods({ loadingScreen: { enabled: true, assets: null } })),
    ).toBe(false);
    expect(
      hasBuiltinMods(withBuiltinMods({ loadingScreen: { enabled: false, assets: "bg.png" } })),
    ).toBe(false);
  });
});

describe("withDecoration", () => {
  it("drops a decoration set back to the game", () => {
    expect(
      withDecoration({ MSITrophy: "show", SR_Hall_Of_Legends: "hide" }, "MSITrophy", "game"),
    ).toEqual({
      SR_Hall_Of_Legends: "hide",
    });
  });

  it("sets a decoration forced off or on", () => {
    expect(withDecoration({}, "MSITrophy", "show")).toEqual({ MSITrophy: "show" });
  });
});

describe("inkingStyle", () => {
  it("returns the preset whose values the settings hold", () => {
    expect(inkingStyle(createMockInking())).toBe("original");
    expect(inkingStyle(INKING_PRESETS.bold)).toBe("bold");
    expect(inkingStyle(INKING_PRESETS.subtle)).toBe("subtle");
  });

  it("returns custom if the values match no preset", () => {
    expect(inkingStyle({ ...INKING_PRESETS.original, width: 51 })).toBe("custom");
    expect(inkingStyle({ ...INKING_PRESETS.subtle, cameraDistance: 6000 })).toBe("custom");
  });
});

describe("rgb8ToColor", () => {
  it("round-trips a stored color through sRGB channels", () => {
    expect(colorToRgb8(rgb8ToColor("#1a2b3c"))).toBe("#1a2b3c");
    expect(rgb8ToColor("#ff0000")).toEqual([1, 0, 0]);
  });

  it("reads black if the stored color is not one", () => {
    expect(rgb8ToColor("red")).toEqual([0, 0, 0]);
  });
});

describe("missingChoices", () => {
  it("returns the choices the install does not hold, ignoring case", () => {
    expect(missingChoices(["ahri", "Zed", "nobody"], ["Ahri", "zed"])).toEqual(["nobody"]);
  });
});
