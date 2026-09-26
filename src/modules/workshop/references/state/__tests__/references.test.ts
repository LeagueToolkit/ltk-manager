import { afterEach, expect, it } from "vitest";

import { useReferencesStore } from "../references";

afterEach(() => useReferencesStore.setState(useReferencesStore.getInitialState(), true));

it("collapses every file it is given and keeps the ones already collapsed", () => {
  const store = useReferencesStore.getState();
  store.toggleFile("a");
  store.collapseFiles(["b", "c"]);
  expect([...useReferencesStore.getState().shutFiles].sort()).toEqual(["a", "b", "c"]);
});
