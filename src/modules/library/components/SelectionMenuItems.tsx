import {
  ChecksIcon,
  HeartbeatIcon,
  ProhibitIcon,
  SpinnerGapIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";

import { Menu } from "@/components";
import { type SelectionActions, useSelectionActions } from "@/modules/library/api";

/**
 * The commands a selection carries, for whichever popup is asking.
 *
 * The floating bar draws the same five as buttons. Per "What a selection
 * carries" in `docs/ux/LIBRARY.md`.
 */
export function SelectionMenuItems() {
  const actions = useSelectionActions();
  const { count } = actions;

  return (
    <Menu.Group>
      <Menu.GroupLabel>{`${count} selected`}</Menu.GroupLabel>
      <Menu.Item
        icon={<ChecksIcon className="h-4 w-4" weight="bold" />}
        disabled={!actions.canEnable}
        onClick={actions.enable}
      >
        Enable {count}
      </Menu.Item>
      <Menu.Item
        icon={<ProhibitIcon className="h-4 w-4" weight="bold" />}
        disabled={!actions.canDisable}
        onClick={actions.disable}
      >
        Disable {count}
      </Menu.Item>
      <SelectionHealthItem actions={actions} />
      <Menu.Item
        icon={<TrashIcon className="h-4 w-4" weight="bold" />}
        variant="danger"
        disabled={!actions.canUninstall}
        onClick={actions.uninstall}
      >
        Uninstall {count}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<XIcon className="h-4 w-4" weight="bold" />} onClick={actions.clear}>
        Clear selection
      </Menu.Item>
    </Menu.Group>
  );
}

/**
 * Check health over the picks, or what the check is still waiting for.
 *
 * Per "What Check Health says while it waits" in docs/ux/MOD_HEALTH.md.
 */
function SelectionHealthItem({ actions }: { actions: SelectionActions }) {
  if (actions.checkReadiness === "syncing") {
    return (
      <Menu.Item icon={<SpinnerGapIcon className="h-4 w-4 animate-spin" weight="bold" />} disabled>
        Syncing hashtables…
      </Menu.Item>
    );
  }

  if (actions.checkReadiness === "unsynced") {
    return (
      <Menu.Item icon={<HeartbeatIcon className="h-4 w-4" weight="bold" />} disabled>
        Hashtables not synced
      </Menu.Item>
    );
  }

  return (
    <Menu.Item
      icon={<HeartbeatIcon className="h-4 w-4" weight="bold" />}
      disabled={actions.count === 0 || actions.checkPending}
      onClick={actions.checkHealth}
    >
      Check health {actions.count}
    </Menu.Item>
  );
}
