// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { createMockInstalledMod } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/utils";

import { useLibraryFilterStore } from "../../state";
import { useVisibleMods } from "../useVisibleMods";

const MODS = [
  createMockInstalledMod({ id: "root-a", displayName: "Root A", folderId: null }),
  createMockInstalledMod({
    id: "in-folder",
    displayName: "Folder One",
    folderId: "f1",
    tags: ["ui"],
  }),
  createMockInstalledMod({ id: "other-folder", displayName: "Folder Two", folderId: "f2" }),
];

/* `useFilteredMods` reaches the WAD reports for its derived categories, so the
   hook needs a client even where no query answers. */
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
);

const ids = (query = "", folderId?: string) =>
  renderHook(() => useVisibleMods(MODS, query, folderId), { wrapper }).result.current.map(
    (m) => m.id,
  );

beforeEach(() => useLibraryFilterStore.getState().clearFilters());

describe("useVisibleMods", () => {
  it("is the whole library on the root route", () => {
    expect(ids()).toEqual(["root-a", "in-folder", "other-folder"]);
  });

  /* The grid draws that folder alone there, and Select all reaches no further
     than what is drawn. */
  it("is one folder's mods on a folder route", () => {
    expect(ids("", "f1")).toEqual(["in-folder"]);
  });

  it("is the whole library on the root folder id", () => {
    expect(ids("", "root")).toHaveLength(3);
  });

  /* A search flattens the folders, so a match outside the one being drilled
     into is on screen and therefore visible. */
  it("reaches past the folder under a search", () => {
    expect(ids("Folder", "f1")).toEqual(["in-folder", "other-folder"]);
  });

  it("reaches past the folder under a filter", () => {
    useLibraryFilterStore.getState().toggleTag("ui");

    expect(ids("", "f2")).toEqual(["in-folder"]);
  });
});
