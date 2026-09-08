import {
  DotsThreeVerticalIcon,
  FolderOpenIcon,
  PackageIcon,
  PlayIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { match } from "ts-pattern";

import { Button, ButtonGroup, IconButton, Menu, Tooltip } from "@/components";
import type { Incident, WorkshopProject } from "@/lib/tauri";
import { useLatestIncident } from "@/modules/diagnostics";
import { useIncidentLineStore } from "@/stores";

import { useProjectActions } from "../api/useProjectActions";
import { useWorkshopTestState } from "../api/useWorkshopTestState";
import { neutralTint, packTint, testTint } from "./actionTints";
import { BuildingTestButton, StopTestButton } from "./testSessionButtons";

interface ProjectActionsProps {
  project: WorkshopProject;
}

/** Test, pack and the overflow menu, joined into one control in the project header. */
export function ProjectActions({ project }: ProjectActionsProps) {
  const testState = useWorkshopTestState(project);
  const actions = useProjectActions(project);
  const failedTest = useFailedTest(project.path);

  const testButton = match(testState)
    .with({ kind: "idle" }, () => {
      const button = (
        <Button
          variant="ghost"
          size="sm"
          left={<PlayIcon weight="bold" className="h-4 w-4" />}
          onClick={actions.handleTestProject}
          className={testTint}
        >
          Test
        </Button>
      );
      if (!failedTest) return button;
      return <Tooltip content={<FailedTestTip incident={failedTest} />}>{button}</Tooltip>;
    })
    .with({ kind: "building-this" }, () => <BuildingTestButton />)
    .with({ kind: "running-this" }, () => <StopTestButton />)
    .with({ kind: "building-other" }, { kind: "running-other" }, ({ otherLabel }) => (
      <Tooltip content={`Testing "${otherLabel}" - stop it first`}>
        <Button
          variant="ghost"
          size="sm"
          disabled
          left={<PlayIcon weight="bold" className="h-4 w-4" />}
          className={testTint}
        >
          Test
        </Button>
      </Tooltip>
    ))
    .with({ kind: "building-library" }, { kind: "running-library" }, () => (
      <Tooltip content="Patcher is running - stop it first">
        <Button
          variant="ghost"
          size="sm"
          disabled
          left={<PlayIcon weight="bold" className="h-4 w-4" />}
          className={testTint}
        >
          Test
        </Button>
      </Tooltip>
    ))
    .exhaustive();

  return (
    <ButtonGroup className="shrink-0">
      {testButton}

      <Button
        variant="ghost"
        size="sm"
        left={<PackageIcon weight="bold" className="h-4 w-4" />}
        onClick={actions.handleOpenPackDialog}
        className={packTint}
      >
        Pack
      </Button>

      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<DotsThreeVerticalIcon weight="bold" className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              aria-label="Project actions"
              className={neutralTint}
            />
          }
        />
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup>
              <Menu.Item
                icon={<FolderOpenIcon className="h-4 w-4" />}
                onClick={actions.handleOpenLocation}
              >
                Open Location
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                icon={<TrashIcon className="h-4 w-4" />}
                variant="danger"
                onClick={actions.handleOpenDeleteDialog}
              >
                Delete
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}

/**
 * The newest undismissed incident, when it came out of a test of this project
 * and no clean game has answered it since.
 */
function useFailedTest(projectPath: string): Incident | null {
  const latest = useLatestIncident();
  const answeredId = useIncidentLineStore((s) => s.answeredIncidentId);

  if (!latest || latest.id === answeredId) return null;
  if (latest.origin.kind !== "workshop") return null;
  return latest.origin.projects.includes(projectPath) ? latest : null;
}

/* Until the problems list exists, the Test button's tooltip is where a modder
   whose test crashed reads the reason. */
function FailedTestTip({ incident }: { incident: Incident }) {
  const navigate = useNavigate();

  return (
    <div className="flex max-w-[260px] flex-col gap-1.5">
      <span className="text-[0.625rem] font-medium tracking-wider text-surface-400 uppercase">
        Last test
      </span>
      <p className="font-semibold text-surface-100">{incident.verdict.title}</p>
      {incident.verdict.subject && (
        <p className="truncate font-mono text-xs text-surface-200">{incident.verdict.subject}</p>
      )}
      <Button
        variant="light"
        size="xs"
        compact
        className="self-start"
        onClick={() =>
          navigate({ to: "/diagnostics", search: { tab: "games", incident: incident.id } })
        }
      >
        Details
      </Button>
    </div>
  );
}
