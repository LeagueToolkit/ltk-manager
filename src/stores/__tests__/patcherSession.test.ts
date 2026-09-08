import { usePatcherSessionStore } from "../patcherSession";

describe("patcherSession store", () => {
  beforeEach(() => {
    usePatcherSessionStore.setState({ testingProjects: [] });
  });

  describe("setTestingProjects", () => {
    it("sets the testing projects list", () => {
      const projects = [
        { path: "/p1", displayName: "Project 1" },
        { path: "/p2", displayName: "Project 2" },
      ];
      usePatcherSessionStore.getState().setTestingProjects(projects);
      expect(usePatcherSessionStore.getState().testingProjects).toEqual(projects);
    });

    it("replaces previous projects", () => {
      usePatcherSessionStore.getState().setTestingProjects([{ path: "/p1", displayName: "Old" }]);
      usePatcherSessionStore.getState().setTestingProjects([{ path: "/p2", displayName: "New" }]);
      expect(usePatcherSessionStore.getState().testingProjects).toEqual([
        { path: "/p2", displayName: "New" },
      ]);
    });
  });

  describe("clearTestingProjects", () => {
    it("clears the testing projects list", () => {
      usePatcherSessionStore
        .getState()
        .setTestingProjects([{ path: "/p1", displayName: "Project 1" }]);
      usePatcherSessionStore.getState().clearTestingProjects();
      expect(usePatcherSessionStore.getState().testingProjects).toEqual([]);
    });
  });
});
