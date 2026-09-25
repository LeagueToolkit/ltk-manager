// @vitest-environment happy-dom

import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetRef } from "@/lib/tauri";

import { readVfxSystem } from "../../../engine/parsing/readVfxSystem";
import { useVfxRun, type VfxRun, VfxRunProvider } from "../run";
import { useVfxRunMemoryStore, vfxRunKey } from "../vfxRunMemory";

/** A system of no emitters, whose run lasts the shortest span, one second. */
const SYSTEM = readVfxSystem({
  materials: [],
  entry: "0x1",
  name: null,
  classHash: "0x1",
  class: "VfxSystemDefinitionData",
  root: {
    type: "struct",
    classHash: "0x1",
    class: "VfxSystemDefinitionData",
    object: null,
    fields: [],
  },
});

vi.mock("../../../hooks/useVfxSystem", () => ({
  useVfxSystem: () => ({ system: SYSTEM, error: null, pending: false }),
}));

const ASSET: AssetRef = { kind: "layer", project: "C:/mods/ahri", layer: "base", path: "ahri.bin" };

const queued = new Map<number, FrameRequestCallback>();
let frameId = 0;
let run: VfxRun;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => queued.delete(key));
});

afterEach(() => {
  cleanup();
  queued.clear();
  vi.unstubAllGlobals();
  useVfxRunMemoryStore.setState({ runs: {} });
});

function Capture() {
  const current = useVfxRun();
  useEffect(() => {
    run = current;
  }, [current]);
  return null;
}

/** A run of `SYSTEM` opened as `document` from `asset`. */
function mount(document = 1, asset: AssetRef | null = ASSET) {
  return render(
    <VfxRunProvider document={document} asset={asset} entry="0x1">
      <Capture />
    </VfxRunProvider>,
  );
}

/** `count` animation frames, 100 ms apart from `from` milliseconds. */
function frames(from: number, count: number) {
  for (let at = 0; at < count; at += 1) {
    act(() => {
      const callbacks = [...queued.values()];
      queued.clear();
      for (const callback of callbacks) callback(from + at * 100);
    });
  }
}

describe("VfxRunProvider", () => {
  it("opens a system looping on the burst rig", () => {
    mount();

    expect(run.looping).toBe(true);
    expect(run.rig.preset).toBe("burst");
    expect(run.playing).toBe(true);
  });

  it("pauses at the end of its span with the loop off, and plays from zero on Play", () => {
    mount();
    act(() => run.setLooping(false));

    frames(0, 14);
    expect(run.playing).toBe(false);
    expect(run.driver.phase).toBeCloseTo(1);
    expect(queued.size).toBe(0);

    act(() => run.setPlaying(true));
    expect(run.driver.phase).toBe(0);
    expect(run.playing).toBe(true);
  });

  it("plays from zero when the loop turns on at the end", () => {
    mount();
    act(() => run.setLooping(false));
    frames(0, 14);

    act(() => run.setLooping(true));

    expect(run.driver.phase).toBe(0);
    expect(run.playing).toBe(true);
  });

  it("keeps the phase a loop showed when it turns off after a pass", () => {
    mount();
    frames(0, 16);
    expect(run.driver.phase).toBeCloseTo(0.5);

    act(() => run.setLooping(false));

    expect(run.driver.phase).toBeCloseTo(0.5);
    expect(run.playing).toBe(true);
  });

  it("pauses the clock through a scrub and continues after it", () => {
    mount();
    frames(0, 2);
    act(() => run.beginScrub());
    frames(200, 3);
    expect(run.driver.phase).toBeCloseTo(0.1);

    act(() => run.seek(0.5));
    act(() => run.endScrub());
    frames(1000, 2);

    expect(run.driver.phase).toBeCloseTo(0.6);
    expect(run.playing).toBe(true);
  });

  it("keeps the clock at zero while warming and plays on once warm", () => {
    mount();
    const setWarming = run.setWarming;
    act(() => run.setWarming(true));
    frames(0, 5);

    expect(run.driver.phase).toBe(0);
    expect(run.playing).toBe(true);
    expect(run.warming).toBe(true);
    expect(run.setWarming).toBe(setWarming);

    act(() => run.setWarming(false));
    frames(1000, 2);
    expect(run.driver.phase).toBeCloseTo(0.1);
  });

  it("goes to the end of a span paused, and short of the wrap while looping", () => {
    mount();
    act(() => run.seekEnd());
    expect(run.playing).toBe(false);
    expect(run.driver.phase).toBeCloseTo(1 - 1 / 60);

    act(() => run.setLooping(false));
    act(() => run.seekEnd());
    expect(run.driver.phase).toBeCloseTo(1);
  });

  it("remembers a run per file across the fresh id each open takes", () => {
    const first = mount(1);
    act(() => {
      run.reroll();
      run.setPinned(0.3);
    });
    frames(0, 4);
    first.unmount();

    mount(2);

    expect(run.seed).toBe(1338);
    expect(run.pinned).toBe(0.3);
    expect(run.resumed).toBe(true);
    expect(run.driver.phase).toBeCloseTo(0.3);
  });

  it("reopens a run left at its end at zero", () => {
    const first = mount();
    act(() => run.setLooping(false));
    frames(0, 14);
    first.unmount();

    mount(2);

    expect(run.looping).toBe(false);
    expect(run.resumed).toBe(false);
    expect(run.driver.phase).toBe(0);
  });
});

describe("vfxRunKey", () => {
  it("keys a file by its project and path, whichever open reads it", () => {
    expect(vfxRunKey({ ...ASSET }, "0x1")).toBe(vfxRunKey(ASSET, "0x1"));
    expect(vfxRunKey({ ...ASSET, project: "C:/mods/lux" }, "0x1")).not.toBe(
      vfxRunKey(ASSET, "0x1"),
    );
    expect(vfxRunKey(ASSET, "0x2")).not.toBe(vfxRunKey(ASSET, "0x1"));
    expect(vfxRunKey(7, "0x1")).not.toBe(vfxRunKey(8, "0x1"));
  });
});
