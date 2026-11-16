import { CaretDownIcon } from "@phosphor-icons/react";

import { Button, Inline, Menu } from "@/components";
import { m } from "@/i18n";

interface SendActionsProps {
  /** Whether a known cause holds the primary button, so that the send actions are a menu. */
  asMenu: boolean;
  /** Whether the report is built and no send is in flight. */
  ready: boolean;
  /** Whether a send is in flight. */
  sending: boolean;
  onIssue: () => void;
  onSave: () => void;
  onCopy: () => void;
}

/**
 * The three ways a report leaves: a GitHub issue, a file and a summary for Discord.
 *
 * `Copy for Discord` is the primary button. If a known cause holds that place, the three
 * actions are items of one `Send report` menu.
 */
export function SendActions({ asMenu, ready, sending, onIssue, onSave, onCopy }: SendActionsProps) {
  if (asMenu) {
    return (
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button loading={sending} right={<CaretDownIcon className="size-4" />}>
              {m.support_send_action()}
            </Button>
          }
        />
        <Menu.Content align="end">
          <Menu.Item disabled={!ready} onClick={onCopy}>
            {m.support_copy_action()}
          </Menu.Item>
          <Menu.Item disabled={!ready} onClick={onSave}>
            {m.support_save_action()}
          </Menu.Item>
          <Menu.Item onClick={onIssue}>{m.support_issue_action()}</Menu.Item>
        </Menu.Content>
      </Menu.Root>
    );
  }

  return (
    <>
      <Button variant="ghost" onClick={onIssue}>
        {m.support_issue_action()}
      </Button>
      <Inline gap={3}>
        <Button disabled={!ready} onClick={onSave}>
          {m.support_save_action()}
        </Button>
        <Button variant="filled" tone="accent" loading={sending} disabled={!ready} onClick={onCopy}>
          {m.support_copy_action()}
        </Button>
      </Inline>
    </>
  );
}
