// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockInstalledMod } from "@/test/fixtures";

import { useSetModsEnabled } from "../useSetModsEnabled";

const toggle = { mutate: vi.fn(), isPending: false };
vi.mock("../useToggleMod", () => ({ useToggleMod: () => toggle }));

const setEnabled = () => renderHook(() => useSetModsEnabled()).result.current.setEnabled;
const asked = () => toggle.mutate.mock.calls.map(([vars]) => vars);

describe("useSetModsEnabled", () => {
  it("leaves the mods already in that state alone", () => {
    toggle.mutate.mockClear();
    const mods = [
      createMockInstalledMod({ id: "on", enabled: true }),
      createMockInstalledMod({ id: "off", enabled: false }),
    ];

    setEnabled()(mods, true);

    expect(asked()).toEqual([{ modId: "off", enabled: true }]);
  });

  /* A card refuses the same press one mod at a time, and a set is not a way
     around it. */
  it("does not switch on a blocked mod", () => {
    toggle.mutate.mockClear();
    const mods = [createMockInstalledMod({ id: "hack", enabled: false, authors: ["rose"] })];

    setEnabled()(mods, true);

    expect(asked()).toEqual([]);
  });

  it("still switches a blocked mod off", () => {
    toggle.mutate.mockClear();
    const mods = [createMockInstalledMod({ id: "hack", enabled: true, authors: ["rose"] })];

    setEnabled()(mods, false);

    expect(asked()).toEqual([{ modId: "hack", enabled: false }]);
  });
});
