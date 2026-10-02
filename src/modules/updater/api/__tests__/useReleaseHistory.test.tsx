// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ReleaseNote, ReleasePage } from "@/lib/tauri";
import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useReleaseHistory } from "../useReleaseHistory";

function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function release(version: string): ReleaseNote {
  return {
    version,
    tag: `v${version}`,
    body: `### Fixed\n\n- Something in ${version}.`,
    publishedAt: "2026-08-30T12:00:00Z",
    prerelease: false,
    url: `https://github.com/LeagueToolkit/ltk-manager/releases/tag/v${version}`,
  };
}

/** The pages `list_releases` hands over, page 1 first. Anything past them is empty and last. */
function mockReleasePages(pages: ReleasePage[]) {
  mockInvoke.mockImplementation((cmd: string, args: { page: number }) => {
    if (cmd !== commandNames.news.listReleases) return Promise.resolve({ ok: true, value: null });
    const page = pages[args.page - 1] ?? { releases: [], nextPage: null };
    return Promise.resolve({ ok: true, value: page });
  });
}

function listedPages() {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === commandNames.news.listReleases);
}

function versions(releases: ReleaseNote[]) {
  return releases.map((entry) => entry.version);
}

describe("useReleaseHistory", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("reads nothing while the surface is closed", () => {
    mockReleasePages([{ releases: [release("1.15.3")], nextPage: null }]);

    const { result } = renderHook(() => useReleaseHistory({ enabled: false }), {
      wrapper: createWrapper(),
    });

    expect(listedPages()).toHaveLength(0);
    expect(result.current.releases).toEqual([]);
  });

  it("follows nextPage as the caller asks for more", async () => {
    mockReleasePages([
      { releases: [release("1.15.3")], nextPage: 2 },
      { releases: [release("1.15.2")], nextPage: null },
    ]);

    const { result } = renderHook(() => useReleaseHistory({ enabled: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(versions(result.current.releases)).toEqual(["1.15.3"]));
    expect(result.current.hasNextPage).toBe(true);

    act(() => result.current.fetchNextPage());

    await waitFor(() => expect(versions(result.current.releases)).toEqual(["1.15.3", "1.15.2"]));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("stops at the page nextPage does not follow", async () => {
    mockReleasePages([{ releases: [release("1.15.3")], nextPage: null }]);

    const { result } = renderHook(() => useReleaseHistory({ enabled: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.hasNextPage).toBe(false);

    act(() => result.current.fetchNextPage());

    expect(listedPages()).toHaveLength(1);
  });

  it("keeps the excluded version out of the list", async () => {
    mockReleasePages([{ releases: [release("1.15.3"), release("1.15.2")], nextPage: null }]);

    const { result } = renderHook(
      () => useReleaseHistory({ enabled: true, excludeVersion: "1.15.3" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(versions(result.current.releases)).toEqual(["1.15.2"]));
  });

  it("lists a tag two pages both carry once", async () => {
    mockReleasePages([
      { releases: [release("1.15.3")], nextPage: 2 },
      { releases: [release("1.15.3"), release("1.15.2")], nextPage: null },
    ]);

    const { result } = renderHook(() => useReleaseHistory({ enabled: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => result.current.fetchNextPage());

    await waitFor(() => expect(versions(result.current.releases)).toEqual(["1.15.3", "1.15.2"]));
  });

  it("fetches on past a page that filters down to nothing", async () => {
    mockReleasePages([
      { releases: [release("1.15.3")], nextPage: 2 },
      { releases: [release("1.15.2")], nextPage: null },
    ]);

    const { result } = renderHook(
      () => useReleaseHistory({ enabled: true, excludeVersion: "1.15.3" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(versions(result.current.releases)).toEqual(["1.15.2"]));
    expect(listedPages()).toHaveLength(2);
  });
});
