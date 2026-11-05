import { describe, expect, it } from "vitest";

import type { LeagueSession } from "@/stores";

import { deriveSessionView, prepareStepLabel, type SessionInputs } from "../sessionView";

const IDLE: SessionInputs = {
  phase: "idle",
  playStep: "idle",
  overlayProgress: null,
  launchProgress: null,
  session: null,
  stopping: false,
  incident: null,
  failure: null,
  patcherAvailable: true,
  hasBroken: false,
  leagueRunning: false,
};

describe("deriveSessionView", () => {
  it("rests idle with the hint for a closed client", () => {
    expect(deriveSessionView(IDLE)).toEqual({
      kind: "idle",
      hint: "Start the patcher to apply your mods.",
    });
  });

  it("draws nothing where the patcher cannot run and nothing is broken", () => {
    expect(deriveSessionView({ ...IDLE, patcherAvailable: false })).toEqual({ kind: "hidden" });
    expect(deriveSessionView({ ...IDLE, patcherAvailable: false, hasBroken: true })).toEqual({
      kind: "itemsOnly",
    });
  });

  it("says the patcher is stopping over everything else", () => {
    expect(deriveSessionView({ ...IDLE, phase: "patching", stopping: true }).kind).toBe("stopping");
  });

  it("rests on the running line once the patcher is up and nothing steps", () => {
    expect(deriveSessionView({ ...IDLE, phase: "patching" }).kind).toBe("running");
  });

  it("steps through the build with the build active", () => {
    const view = deriveSessionView({ ...IDLE, phase: "building" });
    if (view.kind !== "progress") throw new Error(view.kind);

    expect(view.steps.map((step) => [step.key, step.state])).toEqual([
      ["build", "active"],
      ["patcher", "pending"],
    ]);
    expect(view.working).toBe(true);
    expect(view.label).toBe("Preparing build...");
    expect(view.detail).toBeNull();
  });

  it("names the preparing step under the build label", () => {
    const view = deriveSessionView({
      ...IDLE,
      phase: "building",
      overlayProgress: {
        stage: "preparing",
        currentFile: null,
        current: 0,
        total: 0,
        step: { kind: "builtinMod", name: "Character inking" },
      },
    });
    if (view.kind !== "progress") throw new Error(view.kind);

    expect(view.label).toBe("Preparing build...");
    expect(view.detail).toBe("Generating Character inking...");
    expect(view.value).toBeNull();
  });

  it("names the file under a patching stage", () => {
    const view = deriveSessionView({
      ...IDLE,
      phase: "building",
      overlayProgress: {
        stage: "patching",
        currentFile: "Aatrox.wad.client",
        current: 2,
        total: 8,
        step: null,
      },
    });
    if (view.kind !== "progress") throw new Error(view.kind);

    expect(view.label).toBe("Patching WAD files...");
    expect(view.detail).toBe("Aatrox.wad.client");
    expect(view.counter).toBe("2 / 8");
  });

  it("gives every preparing step a line", () => {
    expect(prepareStepLabel({ kind: "patcher" })).toBe("Downloading the patcher...");
    expect(prepareStepLabel({ kind: "gameExit" })).toBe("Waiting for the game to close...");
    expect(prepareStepLabel({ kind: "library" })).toBe("Reading the library...");
    expect(prepareStepLabel({ kind: "game" })).toBe("Reading the game...");
  });

  it("rests in game while nothing else has progress", () => {
    const session = { running: true, version: "15.1", phase: "None" } as LeagueSession;
    const view = deriveSessionView({ ...IDLE, phase: "patching", playStep: "in-game", session });

    expect(view).toEqual({ kind: "inGame", hint: "Your mods are being applied.", version: "15.1" });
  });
});
