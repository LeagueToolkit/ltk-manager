// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetRef, BinRow } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";

import { useLeafEdit } from "../useLeafEdit";

const ASSET: AssetRef = { kind: "file", path: "c:/mods/skin/data/cac.bin" };
const HOLDER = { entry: "0x00000001", path: "" } as BinRow;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockInvoke.mockReset();
});

describe("useLeafEdit", () => {
  it("reopens an evicted document and sends the edit again on the fresh id", async () => {
    mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "bin_edit_property" && args?.document === 3) {
        return Promise.resolve({ ok: false, error: { code: "BIN_NOT_OPEN", id: 3 } });
      }
      return Promise.resolve({ ok: true, value: null });
    });
    const reopen = vi.fn(() => Promise.resolve(9));
    const { result } = renderHook(() => useLeafEdit(3, ASSET, vi.fn(), reopen));

    let landed = false;
    await act(async () => {
      landed = await result.current.editProperty(HOLDER, "0x00000002", []);
    });

    expect(landed).toBe(true);
    expect(reopen).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenLastCalledWith(
      "bin_edit_property",
      expect.objectContaining({ document: 9 }),
    );
  });

  it("keeps the refusal where no reopen is given", async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: { code: "BIN_NOT_OPEN", id: 3 } });
    const { result } = renderHook(() => useLeafEdit(3, ASSET, vi.fn()));

    let landed = true;
    await act(async () => {
      landed = await result.current.editProperty(HOLDER, "0x00000002", []);
    });

    expect(landed).toBe(false);
    expect(result.current.refused.get("0x00000001:")?.code).toBe("BIN_NOT_OPEN");
  });
});
