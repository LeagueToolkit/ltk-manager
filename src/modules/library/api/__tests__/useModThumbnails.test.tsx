// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useModThumbnail } from "../useModThumbnail";
import { ModThumbnails } from "../useModThumbnails";

const IDS = ["b", "a"];

function batched(children: ReactNode) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ModThumbnails modIds={IDS}>{children}</ModThumbnails>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string) => {
    if (command === "get_mod_thumbnails") {
      return Promise.resolve({ ok: true, value: { a: "C:/mods/a/thumbnail.webp" } });
    }
    return Promise.resolve({ ok: true, value: null });
  });
});

describe("ModThumbnails", () => {
  it("asks for every card's thumbnail in one call, sorted", async () => {
    renderHook(() => useModThumbnail("a"), { wrapper: ({ children }) => batched(children) });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());

    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("get_mod_thumbnails", {
      modIds: ["a", "b"],
    });
  });

  it("answers a card out of the batch", async () => {
    const { result } = renderHook(() => useModThumbnail("a"), {
      wrapper: ({ children }) => batched(children),
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(result.current.data).toContain("thumbnail.webp");
  });

  it("answers a mod the batch has no thumbnail for with nothing", async () => {
    const { result } = renderHook(() => useModThumbnail("b"), {
      wrapper: ({ children }) => batched(children),
    });

    await waitFor(() => expect(result.current.data).toBe(""));

    expect(mockInvoke).not.toHaveBeenCalledWith("get_mod_thumbnail", expect.anything());
  });
});
