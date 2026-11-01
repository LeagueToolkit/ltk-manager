import { CaretDownIcon, PlayIcon } from "@phosphor-icons/react";
import { match } from "ts-pattern";

import { Button, ButtonGroup, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import { useActiveProfile } from "@/modules/library";

import { testTint } from "../../shared/utils/actionTints";
import { useWorkshopTestState } from "../../testing/api/useWorkshopTestState";
import { BuildingTestButton, StopTestButton } from "../../testing/components/testSessionButtons";
import { useProjectSelectionActions } from "../hooks/useProjectSelectionActions";

/**
 * The list's Test, floating over the bottom right corner of the list it is drawn in.
 *
 * Positioned against the nearest positioned ancestor, which the list's route provides.
 * Per "Selection, and a running session" in `docs/ux/WORKSHOP.md`.
 */
export function WorkshopTestDock() {
  return (
    <div
      data-ui="WorkshopTestDock"
      /* DS-GROUND: floats over the island's card. */
      className="absolute right-1 bottom-1 z-10 flex rounded-lg border border-surface-600 bg-surface-800 p-1 shadow-lg select-none"
    >
      <WorkshopTestButton />
    </div>
  );
}

/** Tests the picked projects, and ends the session that test started. */
function WorkshopTestButton() {
  const actions = useProjectSelectionActions();
  const testState = useWorkshopTestState();
  const { data: activeProfile } = useActiveProfile();
  let profileLabel = m.workshop_test_over_profile_action();
  let profileHint = profileLabel;
  if (activeProfile) {
    profileLabel = m.workshop_test_over_named_profile_action({ profile: activeProfile.name });
    profileHint = m.workshop_list_test_hint({ count: actions.count, profile: activeProfile.name });
  }

  /* Named with no project, so `useWorkshopTestState`'s "other" is simply the
     session the list started - there is no this-project for it to be other
     than. */
  return match(testState)
    .with({ kind: "idle" }, () => (
      <ButtonGroup>
        <Tooltip content={testHint(actions.count)}>
          <Button
            variant="ghost"
            size="sm"
            left={<PlayIcon weight="bold" className="size-3.5" />}
            loading={actions.testPending}
            disabled={!actions.canTest}
            onClick={actions.test}
            className={testTint}
          >
            {m.workshop_header_test_action()}
          </Button>
        </Tooltip>
        <Menu.Root>
          <Tooltip content={profileHint}>
            <Menu.Trigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className={testTint}
                  disabled={!actions.canTest || actions.testPending}
                  aria-label={m.workshop_test_options_label()}
                >
                  <CaretDownIcon className="size-3.5" />
                </Button>
              }
            />
          </Tooltip>
          <Menu.Content align="end">
            <Menu.Item icon={<PlayIcon className="size-4" />} onClick={actions.testOverProfile}>
              {profileLabel}
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </ButtonGroup>
    ))
    .with({ kind: "building-this" }, { kind: "building-other" }, () => <BuildingTestButton />)
    .with({ kind: "running-this" }, { kind: "running-other" }, () => <StopTestButton />)
    .with({ kind: "building-library" }, { kind: "running-library" }, () => (
      <Tooltip content={m.workshop_list_test_library_hint()}>
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
}

/** The primary action tests only the selected projects. */
function testHint(count: number): string {
  if (count === 0) return m.workshop_list_test_empty_hint();
  return m.workshop_list_test_alone_hint({ count });
}
