import { renderHook } from "@testing-library/react";

import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useDisplayStore } from "@/stores/displayStore";

function createMockMatchMedia(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn((_, handler) => listeners.push(handler)),
    removeEventListener: vi.fn((_, handler) => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    dispatchChange: (newMatches: boolean) => {
      mql.matches = newMatches;
      listeners.forEach((fn) => fn({ matches: newMatches } as MediaQueryListEvent));
    },
  };
  return mql;
}

describe("useReducedMotion", () => {
  let mockMql: ReturnType<typeof createMockMatchMedia>;

  beforeEach(() => {
    useDisplayStore.setState({ reduceMotion: "system" });
    mockMql = createMockMatchMedia(false);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mockMql),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when store is 'on'", () => {
    useDisplayStore.setState({ reduceMotion: "on" });
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when store is 'off'", () => {
    useDisplayStore.setState({ reduceMotion: "off" });
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns false when store is 'system' and OS does not prefer reduced motion", () => {
    mockMql = createMockMatchMedia(false);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mockMql),
    );
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when store is 'system' and OS prefers reduced motion", () => {
    mockMql = createMockMatchMedia(true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mockMql),
    );
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("responds to live OS media query changes", async () => {
    const { result, rerender } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    await vi.waitFor(() => {
      mockMql.dispatchChange(true);
      rerender();
      expect(result.current).toBe(true);
    });
  });

  it("cleans up event listener on unmount", () => {
    const { unmount } = renderHook(() => useReducedMotion());
    unmount();
    expect(mockMql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
