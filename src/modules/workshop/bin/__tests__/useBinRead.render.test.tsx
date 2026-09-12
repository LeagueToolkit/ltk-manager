// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { BinRows } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useBinRead } from "../useBinRead";

const ENTRY = "0x2a1f3c7d";
const PAGE: BinRows = { rows: [], total: 0 };

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command !== "bin_read") return Promise.resolve({ ok: false, error: { code: "UNKNOWN" } });
    const paths = (args?.paths ?? []) as string[];
    return Promise.resolve({ ok: true, value: paths.map(() => PAGE) });
  });
});

describe("useBinRead", () => {
  it("keeps the map's identity across a render that asks for the same nodes", async () => {
    const { result, rerender } = renderHook(
      () => useBinRead(9, [{ key: `${ENTRY}:0000000a`, rows: 2 }]),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    const answered = result.current;

    rerender();

    expect(result.current).toBe(answered);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("answers a new map once the nodes asked for change", async () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useBinRead(9, [{ key: `${ENTRY}:${path}`, rows: 2 }]),
      { wrapper: Providers, initialProps: { path: "0000000a" } },
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    const first = result.current;

    rerender({ path: "0000000b" });
    await waitFor(() => expect(result.current.has(`${ENTRY}:0000000b`)).toBe(true));

    expect(result.current).not.toBe(first);
    expect(result.current.has(`${ENTRY}:0000000a`)).toBe(false);
  });
});
