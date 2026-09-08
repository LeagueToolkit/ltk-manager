import { create } from "zustand";

interface TestingProject {
  path: string;
  displayName: string;
}

interface PatcherSessionStore {
  testingProjects: TestingProject[];
  setTestingProjects: (projects: TestingProject[]) => void;
  clearTestingProjects: () => void;
  /**
   * Set from the moment a stop is asked for until the patcher reports itself
   * idle.
   *
   * `stop_patcher` only sets an atomic flag and returns, so the mutation's own
   * pending state lasts milliseconds while the session thread takes seconds to
   * unwind - long enough that a button keyed to the mutation reads as still
   * running, then snaps to idle with nothing in between.
   */
  stopping: boolean;
  setStopping: (stopping: boolean) => void;
}

export const usePatcherSessionStore = create<PatcherSessionStore>()((set) => ({
  testingProjects: [],
  setTestingProjects: (projects) => set({ testingProjects: projects }),
  clearTestingProjects: () => set({ testingProjects: [] }),
  stopping: false,
  setStopping: (stopping) => set({ stopping }),
}));
