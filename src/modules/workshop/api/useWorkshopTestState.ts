import { useMemo } from "react";

import type { WorkshopProject } from "@/lib/tauri";
import { usePatcherStatus } from "@/modules/patcher";
import { usePatcherSessionStore } from "@/stores";

import { useSessionProjectNames } from "./useSessionProjectNames";

export type WorkshopTestState =
  | { kind: "idle" }
  | { kind: "building-this" }
  | { kind: "running-this" }
  | { kind: "building-other"; otherLabel: string }
  | { kind: "running-other"; otherLabel: string }
  | { kind: "building-library" }
  | { kind: "running-library" };

function describe(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.length} projects`;
}

/**
 * What the patcher is doing, from the point of view of one workshop project.
 *
 * The session in flight is the source of truth, so this survives a reload: the
 * store only covers the gap between the click and the first status poll, where
 * there is no session to read yet.
 */
export function useWorkshopTestState(project?: WorkshopProject): WorkshopTestState {
  const { data: status } = usePatcherStatus();
  const testingProjects = usePatcherSessionStore((s) => s.testingProjects);
  const sessionProjects = useSessionProjectNames();

  return useMemo<WorkshopTestState>(() => {
    const session = status?.session ?? null;
    const inBuildPhase = status?.phase === "building";

    if (!session) {
      if (testingProjects.length === 0) return { kind: "idle" };

      const isThis = project ? testingProjects.some((p) => p.path === project.path) : false;
      if (isThis) return { kind: "building-this" };
      return { kind: "building-other", otherLabel: describe(sessionProjects) };
    }

    if (session.origin.kind === "library") {
      return inBuildPhase ? { kind: "building-library" } : { kind: "running-library" };
    }

    if (project && session.origin.projects.includes(project.path)) {
      return inBuildPhase ? { kind: "building-this" } : { kind: "running-this" };
    }

    const otherLabel = describe(sessionProjects);
    return inBuildPhase
      ? { kind: "building-other", otherLabel }
      : { kind: "running-other", otherLabel };
  }, [status, project, testingProjects, sessionProjects]);
}
