import {
  DotsThreeVerticalIcon,
  FolderOpenIcon,
  PackageIcon,
  PlayIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { match } from "ts-pattern";

import { Button, ButtonGroup, IconButton, Menu, RuneforgeIcon, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { Incident, WorkshopProject } from "@/lib/tauri";
import { useLatestIncident } from "@/modules/diagnostics";
import { usePublishToRuneforge } from "@/modules/runeforge";
import { useIncidentLineStore } from "@/stores";

import { packTargetHint, PackTargetMenu } from "../../packing/components/PackTargetMenu";
import { neutralTint, packTint, testTint } from "../../shared/utils/actionTints";
import { packFormats, usePackTarget } from "../../state";
import { useWorkshopTestState } from "../../testing/api/useWorkshopTestState";
import { TestLayersMenu } from "../../testing/components/TestLayersMenu";
import { BuildingTestButton, StopTestButton } from "../../testing/components/testSessionButtons";
import { useProjectActions } from "../hooks/useProjectActions";

interface ProjectActionsProps {
  project: WorkshopProject;
}

/** Test and pack, each with its caret, and the overflow menu, joined into one control in the status row. */
export function ProjectActions({ project }: ProjectActionsProps) {
  const testState = useWorkshopTestState(project);
  const actions = useProjectActions(project);
  const failedTest = useFailedTest(project.path);
  const packTarget = usePackTarget();
  const publishToRuneforge = usePublishToRuneforge();

  const testButton = match(testState)
    .with({ kind: "idle" }, () => {
      const button = (
        <Button
          variant="ghost"
          size="sm"
          left={<PlayIcon weight="bold" className="size-3.5" />}
          onClick={actions.handleTestProject}
          className={testTint}
        >
          {m.workshop_header_test_action()}
        </Button>
      );
      if (!failedTest) return button;
      return <Tooltip content={<FailedTestTip incident={failedTest} />}>{button}</Tooltip>;
    })
    .with({ kind: "building-this" }, () => <BuildingTestButton />)
    .with({ kind: "running-this" }, () => <StopTestButton />)
    .with({ kind: "building-other" }, { kind: "running-other" }, ({ otherLabel }) => (
      <Tooltip content={m.workshop_header_test_blocked_hint({ name: otherLabel })}>
        <Button
          variant="ghost"
          size="sm"
          disabled
          left={<PlayIcon weight="bold" className="size-3.5" />}
          className={testTint}
        >
          {m.workshop_header_test_action()}
        </Button>
      </Tooltip>
    ))
    .with({ kind: "building-library" }, { kind: "running-library" }, () => (
      <Tooltip content={m.workshop_header_test_patcher_hint()}>
        <Button
          variant="ghost"
          size="sm"
          disabled
          left={<PlayIcon weight="bold" className="size-3.5" />}
          className={testTint}
        >
          {m.workshop_header_test_action()}
        </Button>
      </Tooltip>
    ))
    .exhaustive();

  return (
    <ButtonGroup className="shrink-0">
      {testButton}
      <TestLayersMenu
        project={project}
        className={testTint}
        onTestOverProfile={actions.handleTestOverProfile}
        disabled={testState.kind !== "idle" || actions.isTesting}
      />

      <Tooltip content={packTargetHint(packTarget)}>
        <Button
          variant="ghost"
          size="sm"
          left={<PackageIcon weight="bold" className="size-3.5" />}
          loading={actions.isPacking}
          onClick={actions.handlePack}
          className={packTint}
        >
          {actions.isPacking ? m.workshop_pack_packing_label() : m.workshop_header_pack_action()}
        </Button>
      </Tooltip>
      <PackTargetMenu className={packTint} />

      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<DotsThreeVerticalIcon />}
              size="sm"
              aria-label={m.workshop_header_actions_label()}
              className={neutralTint}
            />
          }
        />
        <Menu.Content>
          <Menu.Item
            icon={<FolderOpenIcon className="size-4" />}
            onClick={actions.handleOpenLocation}
          >
            {m.workshop_header_open_location_action()}
          </Menu.Item>
          <Menu.Item
            icon={<RuneforgeIcon className="size-4" />}
            onClick={() => publishToRuneforge(project, packFormats(packTarget)[0])}
          >
            {m.runeforge_publish_action()}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item
            icon={<TrashIcon className="size-4" />}
            variant="danger"
            onClick={actions.handleOpenDeleteDialog}
          >
            {m.workshop_header_delete_action()}
          </Menu.Item>
        </Menu.Content>
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
      <span className="text-fine font-medium tracking-wider text-surface-400 uppercase">
        {m.workshop_header_last_test_label()}
      </span>
      <p className="font-semibold text-surface-100">{incident.verdict.title}</p>
      {incident.verdict.subject && (
        <p className="truncate font-mono text-xs text-surface-200">{incident.verdict.subject}</p>
      )}
      <Button
        variant="tonal"
        size="xs"
        className="self-start"
        onClick={() =>
          navigate({ to: "/diagnostics", search: { tab: "games", incident: incident.id } })
        }
      >
        {m.workshop_header_last_test_details_action()}
      </Button>
    </div>
  );
}
