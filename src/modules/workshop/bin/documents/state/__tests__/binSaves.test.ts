// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BinDocumentId } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";

import {
  clearRefusedBy,
  flushBinSave,
  forgetBinSave,
  isQueuedThrough,
  markRefused,
  queueForSave,
  saveBinNow,
  useBinSave,
} from "../binSaves";

const ASSET = "layer:C:/mods/skin:base:data/skin0.bin";
const DOCUMENT = 7 as BinDocumentId;
const FRESH = 9 as BinDocumentId;

function state() {
  return renderHook(() => useBinSave(ASSET)).result.current.state;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ ok: true, value: null });
});

afterEach(() => {
  forgetBinSave(ASSET);
  vi.useRealTimers();
});

describe("the bin save queue", () => {
  it("saves once after the wait, however many patches queued it", async () => {
    queueForSave(ASSET, DOCUMENT);
    queueForSave(ASSET, DOCUMENT);
    expect(state()).toBe("pending");
    expect(isQueuedThrough(ASSET, DOCUMENT)).toBe(true);

    await vi.advanceTimersByTimeAsync(600);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("bin_save", { document: DOCUMENT });
    expect(state()).toBe("clean");
    expect(isQueuedThrough(ASSET, DOCUMENT)).toBe(false);
  });

  it("writes at once on a flush, and nothing when no save is queued", async () => {
    await flushBinSave(ASSET);
    expect(mockInvoke).not.toHaveBeenCalled();

    queueForSave(ASSET, DOCUMENT);
    await flushBinSave(ASSET);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("reads failed on a refusal, and a save now writes it again through the id it is given", async () => {
    mockInvoke.mockResolvedValueOnce({ ok: false, error: { code: "BIN_CHANGED_ON_DISK" } });
    queueForSave(ASSET, DOCUMENT);
    await flushBinSave(ASSET);

    const { result } = renderHook(() => useBinSave(ASSET));
    expect(result.current).toEqual({ state: "failed", error: { code: "BIN_CHANGED_ON_DISK" } });

    await saveBinNow(ASSET, FRESH);
    expect(mockInvoke).toHaveBeenLastCalledWith("bin_save", { document: FRESH });
    expect(state()).toBe("clean");
  });

  it("rejects a save now that fails, and writes nothing when nothing is owed", async () => {
    await saveBinNow(ASSET, DOCUMENT);
    expect(mockInvoke).not.toHaveBeenCalled();

    mockInvoke.mockResolvedValueOnce({ ok: false, error: { code: "BIN_UNWRITABLE" } });
    queueForSave(ASSET, DOCUMENT);
    await expect(saveBinNow(ASSET, DOCUMENT)).rejects.toEqual({ code: "BIN_UNWRITABLE" });
  });

  it("reads blocked while a field is refused, whatever lands meanwhile, and failed over it", async () => {
    markRefused(ASSET, "tab-a:0x1:scale", true);
    expect(state()).toBe("blocked");

    queueForSave(ASSET, DOCUMENT);
    expect(state()).toBe("blocked");

    markRefused(ASSET, "tab-a:0x1:scale", false);
    expect(state()).toBe("pending");

    markRefused(ASSET, "tab-b:0x1:tint", true);
    mockInvoke.mockResolvedValueOnce({ ok: false, error: { code: "BIN_CHANGED_ON_DISK" } });
    await flushBinSave(ASSET);
    expect(state()).toBe("failed");

    clearRefusedBy(ASSET, "tab-b:");
    await saveBinNow(ASSET, DOCUMENT);
    expect(state()).toBe("clean");
  });

  it("keeps a patch that landed during the write pending", async () => {
    let answer: (value: unknown) => void = () => {};
    mockInvoke.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    queueForSave(ASSET, DOCUMENT);
    const writing = flushBinSave(ASSET);
    expect(state()).toBe("saving");

    queueForSave(ASSET, DOCUMENT);
    answer({ ok: true, value: null });
    await writing;

    expect(state()).toBe("pending");
  });
});
