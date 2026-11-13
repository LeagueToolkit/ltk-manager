import {
  ArrowSquareOutIcon,
  BracketsSquareIcon,
  ClipboardTextIcon,
  CopyIcon,
  CopySimpleIcon,
  GitForkIcon,
  HashIcon,
  ListNumbersIcon,
  PencilSimpleIcon,
  PlusIcon,
  ScissorsIcon,
  SwapIcon,
  ShuffleIcon,
  TrashIcon,
  WaveformIcon,
} from "@phosphor-icons/react";

import { ContextMenu, ExperimentalChip } from "@/components";
import { m } from "@/i18n";
import type { AudioEvent, ContainerKind, MediaLocation } from "@/lib/tauri";

import { previewDocument } from "../../documents/utils/contentDocument";
import { useOptionalProjectContext } from "../../projects/state/ProjectContext";
import { useOpenDocumentAs } from "../../state";
import { useOpenSiteRow, useOpenVoiceLine } from "../hooks/useOpenSiteRow";
import { useFocusMedia } from "../state/mediaFocus";
import { menuShortcut } from "../utils/keymap";
import type { MenuSubject } from "../utils/viewRows";

/** What the menu of a row does to the picked rows, each null where it does not apply. */
export interface NodeActions {
  /** Opens the add row of the row's container or event. */
  readonly add: (() => void) | null;
  readonly duplicate: (() => void) | null;
  readonly alias?: (() => void) | null;
  readonly wrap: ((container: ContainerKind) => void) | null;
  readonly remove: (() => void) | null;
  readonly copy: () => void;
  /** Opens the name entry of the picked event, to rename it. */
  readonly rename: ((event: AudioEvent) => void) | null;
  /** Replaces the media that the picked sound plays with a file. */
  readonly replace: ((source: number) => void) | null;
  /** Holds the picked sounds and containers for a paste that moves them. */
  readonly cut: (() => void) | null;
  /** Moves the cut nodes into the selected container. */
  readonly paste: (() => void) | null;
}

const WRAPS: readonly {
  readonly kind: ContainerKind;
  readonly icon: typeof ShuffleIcon;
  readonly label: () => string;
}[] = [
  { kind: "random", icon: ShuffleIcon, label: () => m.audio_add_random_action() },
  { kind: "sequence", icon: ListNumbersIcon, label: () => m.audio_add_sequence_action() },
  { kind: "switch", icon: GitForkIcon, label: () => m.audio_add_switch_action() },
];

interface EventMenuProps {
  /** The object of the row that the menu opened on. */
  readonly subject: MenuSubject;
  /** The actions on the picked rows, or null in a bank that takes no edit. */
  readonly actions: NodeActions | null;
  /** The count of the picked rows that the actions take. */
  readonly count: number;
  /** Copies the row's name or ID when the bank takes no edit. */
  readonly onCopy: (subject: MenuSubject) => void;
}

/**
 * The context menu of one row of the event tree: the edits of the picked rows, the copies, Show
 * media on a sound whose media is found, and the rows of an event's sites. The experimental
 * actions share one group under one Experimental chip.
 *
 * Every item carries its icon, and the key that does the same in the tree. Per "Row actions" and
 * "Selection" in docs/ux/AUDIO.md.
 */
export function EventMenu({ subject, actions, count, onCopy }: EventMenuProps) {
  const project = useOptionalProjectContext();
  const media =
    subject.kind === "node" && subject.node.kind === "sound" ? subject.node.media : null;
  const event = subject.kind === "event";
  const source =
    subject.kind === "node" && subject.node.kind === "sound" ? subject.node.source : null;
  const rename = subject.kind === "event" ? actions?.rename : null;
  const replace = source === null ? null : actions?.replace;
  const creates =
    actions !== null &&
    (actions.add !== null ||
      actions.duplicate !== null ||
      actions.cut !== null ||
      actions.paste !== null ||
      rename != null);
  const copyLabel =
    count > 1
      ? m.audio_node_copy_many_action({ count })
      : event
        ? m.audio_event_copy_name_action()
        : m.audio_event_copy_id_action();

  return (
    <>
      {actions !== null && (creates || replace != null) && (
        <ContextMenu.Group>
          <ContextMenu.GroupLabel>
            <ExperimentalChip />
          </ContextMenu.GroupLabel>
          {actions.add !== null && (
            <ContextMenu.Item
              icon={<PlusIcon />}
              shortcut={menuShortcut("add")}
              onClick={actions.add}
            >
              {m.audio_node_add_action()}
            </ContextMenu.Item>
          )}
          {actions.duplicate !== null && (
            <ContextMenu.Item
              icon={<CopySimpleIcon />}
              shortcut={menuShortcut("duplicate")}
              onClick={actions.duplicate}
            >
              {m.audio_node_duplicate_action()}
            </ContextMenu.Item>
          )}
          {actions.alias != null && subject.kind === "event" && (
            <ContextMenu.Item icon={<ArrowSquareOutIcon />} onClick={actions.alias}>
              {m.audio_event_alias_action()}
            </ContextMenu.Item>
          )}
          {actions.cut !== null && (
            <ContextMenu.Item
              icon={<ScissorsIcon />}
              shortcut={menuShortcut("cut")}
              onClick={actions.cut}
            >
              {m.audio_node_cut_action()}
            </ContextMenu.Item>
          )}
          {actions.paste !== null && (
            <ContextMenu.Item
              icon={<ClipboardTextIcon />}
              shortcut={menuShortcut("paste")}
              onClick={actions.paste}
            >
              {m.audio_node_paste_action()}
            </ContextMenu.Item>
          )}
          {actions.wrap !== null && <WrapItems wrap={actions.wrap} />}
          {rename != null && subject.kind === "event" && (
            <ContextMenu.Item icon={<PencilSimpleIcon />} onClick={() => rename(subject.event)}>
              {m.audio_event_rename_action()}
            </ContextMenu.Item>
          )}
          {replace != null && source !== null && (
            <ContextMenu.Item icon={<SwapIcon />} onClick={() => replace(source)}>
              {m.audio_replace_action()}
            </ContextMenu.Item>
          )}
        </ContextMenu.Group>
      )}
      {actions?.remove != null && (
        <ContextMenu.Item
          icon={<TrashIcon />}
          shortcut={menuShortcut("remove")}
          variant="danger"
          onClick={actions.remove}
        >
          {m.audio_node_delete_action()}
        </ContextMenu.Item>
      )}
      {actions !== null && <ContextMenu.Separator />}
      {(event || subject.kind === "action" || subject.kind === "node") && (
        <ContextMenu.Item
          icon={event && count <= 1 ? <CopyIcon /> : <HashIcon />}
          shortcut={menuShortcut("copy")}
          onClick={() => (actions === null ? onCopy(subject) : actions.copy())}
        >
          {copyLabel}
        </ContextMenu.Item>
      )}
      {media !== null && project !== null && <ShowMediaItem media={media} />}
      {subject.kind === "event" && project !== null && <EventSiteItems event={subject.event} />}
    </>
  );
}

/** Wrap in container and its submenu of the container kinds. */
function WrapItems({ wrap }: { wrap: (container: ContainerKind) => void }) {
  return (
    <ContextMenu.SubmenuRoot>
      <ContextMenu.SubmenuTrigger icon={<BracketsSquareIcon />}>
        {m.audio_node_wrap_action()}
      </ContextMenu.SubmenuTrigger>
      <ContextMenu.SubmenuContent>
        {WRAPS.map(({ kind, icon: Icon, label }) => (
          <ContextMenu.Item
            key={kind}
            icon={<Icon />}
            shortcut={kind === "random" ? menuShortcut("wrap") : undefined}
            onClick={() => wrap(kind)}
          >
            {label()}
          </ContextMenu.Item>
        ))}
      </ContextMenu.SubmenuContent>
    </ContextMenu.SubmenuRoot>
  );
}

/**
 * Show contextual rule, which opens the Voice lines view at the first rule that plays `event`, and
 * Show in bank unit,
 * which opens the `events[i]` row of the unit that lists its name.
 *
 * Rendered only inside a project, which owns the editor tabs.
 */
function EventSiteItems({ event }: { event: AudioEvent }) {
  const openRow = useOpenSiteRow();
  const openLine = useOpenVoiceLine();
  const rule = event.contexts[0]?.row ?? null;
  const listed = event.listed;

  return (
    <>
      {rule !== null && rule.asset !== null && (
        <ContextMenu.Item icon={<ArrowSquareOutIcon />} onClick={() => openLine(rule)}>
          {m.audio_event_show_rule_action()}
        </ContextMenu.Item>
      )}
      {listed !== null && listed.asset !== null && (
        <ContextMenu.Item icon={<ArrowSquareOutIcon />} onClick={() => openRow(listed)}>
          {m.audio_event_show_in_unit_action()}
        </ContextMenu.Item>
      )}
    </>
  );
}

/**
 * Opens the document of the file that contains `media`, on its Media tab with the row selected.
 *
 * Rendered only inside a project, which owns the editor tabs.
 */
function ShowMediaItem({ media }: { media: MediaLocation }) {
  const open = useOpenDocumentAs();
  const focus = useFocusMedia();

  return (
    <ContextMenu.Item
      icon={<WaveformIcon />}
      onClick={() => {
        focus(media.asset, media.source);
        open(previewDocument(media.asset, media.path), "default");
      }}
    >
      {m.audio_event_show_media_action()}
    </ContextMenu.Item>
  );
}
