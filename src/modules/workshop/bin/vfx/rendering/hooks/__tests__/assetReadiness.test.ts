// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { Texture, TextureLoader } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NamedAsset } from "@/lib/tauri";

import type { EmitterModel } from "../../../engine/model/model";
import type { DrawnEmitter } from "../../utils/definitions";
import { useVfxTextures } from "../useVfxTextures";

const ASSET: NamedAsset = { path: "spark.dds", asset: { kind: "file", path: "C:/spark.dds" } };
const MULT: NamedAsset = { path: "mult.dds", asset: { kind: "file", path: "C:/mult.dds" } };

function drawn(texture: NamedAsset): DrawnEmitter[] {
  return [
    {
      key: "0",
      path: "",
      root: 0,
      rank: 0,
      emitter: {
        texture,
        multTexture: MULT,
        colorTexture: null,
        palette: null,
        erosion: null,
        distortion: null,
        reflection: null,
      } as EmitterModel,
    },
  ];
}

/* The cache keeps a released texture for a grace period, which a test runs out so the
   next one starts on an empty cache. */
const RELEASE_GRACE_MS = 15_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("flight texture readiness", () => {
  it("waits for every named texture and reports a failed decode", async () => {
    const requests: { loaded: (texture: Texture<HTMLImageElement>) => void; failed: () => void }[] =
      [];
    vi.spyOn(TextureLoader.prototype, "load").mockImplementation(
      (_url, loaded, _progress, failed) => {
        requests.push({ loaded: loaded!, failed: () => failed?.(new Error("decode")) });
        return new Texture<HTMLImageElement>();
      },
    );
    const report = vi.fn();
    const definitions = drawn(ASSET);
    const { result } = renderHook(() => useVfxTextures(definitions, report));
    expect(report).toHaveBeenLastCalledWith({ pending: 2, failed: 0 });
    const texture = new Texture<HTMLImageElement>();
    await act(async () => {
      requests[0].loaded(texture);
    });
    expect(result.current.get("0")?.base).toBe(texture);
    expect(report).toHaveBeenLastCalledWith({ pending: 1, failed: 0 });
    await act(async () => {
      requests[1].failed();
    });
    expect(report).toHaveBeenLastCalledWith({ pending: 0, failed: 1 });
  });

  it("reports unresolved assets and discards late completion after unmount", async () => {
    let complete: ((texture: Texture<HTMLImageElement>) => void) | undefined;
    vi.spyOn(TextureLoader.prototype, "load").mockImplementation((_url, loaded) => {
      complete = loaded;
      return new Texture<HTMLImageElement>();
    });
    const report = vi.fn();
    const definitions = drawn({ ...ASSET, asset: null });
    const { unmount } = renderHook(() => useVfxTextures(definitions, report));
    expect(report).toHaveBeenLastCalledWith({ pending: 1, failed: 1 });
    unmount();
    vi.advanceTimersByTime(RELEASE_GRACE_MS);
    const calls = report.mock.calls.length;
    const texture = new Texture<HTMLImageElement>();
    const dispose = vi.spyOn(texture, "dispose");
    await act(async () => {
      complete!(texture);
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledTimes(calls);
  });
});
