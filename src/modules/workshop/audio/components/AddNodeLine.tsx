import {
  ArrowsInIcon,
  FileArrowUpIcon,
  FolderSimplePlusIcon,
  GitForkIcon,
  ListNumbersIcon,
  PlusIcon,
  ShuffleIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { Button, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { ContainerKind, MediaLocation, NodeParent, SetFile } from "@/lib/tauri";

import type { TreeEditing } from "../utils/treeEditing";
import { NodePicker } from "./FieldRows";
import { MediaPicker } from "./VoiceRowParts";

interface AddNodeLineProps {
  readonly into: NodeParent;
  readonly editing: TreeEditing;
  /** The files of the bank set, whose media a new sound plays. */
  readonly files: readonly SetFile[];
  /** The objects that a moved node may not be: the container and its children. */
  readonly exclude: ReadonlySet<number>;
  /** `true` while the tree asks the line to open its menu, after Enter or Ctrl+Enter. */
  readonly opening: boolean;
  readonly onOpening: (open: boolean) => void;
  /** Plays a media of the picker before it is chosen. */
  readonly onPreview: (media: MediaLocation) => void;
  /** The line closed its menu or a picker, which returns focus to the tree. */
  readonly onLeave: () => void;
  /** `true` while a menu command asks the line to open its media picker. */
  readonly mediaRequested?: boolean;
  /** The line opened its media picker for the request. */
  readonly onMediaRequestTaken?: () => void;
}

/** What the line shows in place of its press. */
type Picking = "none" | "media" | "existing";

const CONTAINERS: readonly {
  readonly kind: ContainerKind;
  readonly icon: typeof ShuffleIcon;
  readonly label: () => string;
}[] = [
  { kind: "random", icon: ShuffleIcon, label: () => m.audio_add_random_action() },
  { kind: "sequence", icon: ListNumbersIcon, label: () => m.audio_add_sequence_action() },
  { kind: "switch", icon: GitForkIcon, label: () => m.audio_add_switch_action() },
];

/**
 * The add row at the end of an event's actions or a container's children: `+ Add` and its typed
 * menu. The tooltip of the press marks the actions as experimental.
 *
 * New sound opens the media picker over the bank set, From file imports a `.wem`, Container adds
 * an empty container of a kind, and Existing opens the node picker. Under an event each of them
 * is played by a new Play action. Per "New objects" in docs/ux/AUDIO.md.
 */
export function AddNodeLine({
  into,
  editing,
  files,
  exclude,
  opening,
  onOpening,
  onPreview,
  onLeave,
  mediaRequested = false,
  onMediaRequestTaken,
}: AddNodeLineProps) {
  const [picking, setPicking] = useState<Picking>("none");

  /* Insert - New sound reaches the line once the tree draws it, which can be after the press. */
  useEffect(() => {
    if (!mediaRequested) return;

    setPicking("media");
    onMediaRequestTaken?.();
  }, [mediaRequested, onMediaRequestTaken]);

  function close() {
    setPicking("none");
    onLeave();
  }

  /* The menu is still closing when an item fires, and it takes focus back first. */
  function pick(next: Picking) {
    setTimeout(() => setPicking(next), 0);
  }

  async function importFile() {
    const selected = await open({
      multiple: true,
      directory: false,
      title: m.audio_add_file_title(),
      filters: [{ name: m.audio_add_file_filter_label(), extensions: ["wem"] }],
    });
    if (typeof selected === "string") {
      await editing.importWem(into, selected);
    } else if (Array.isArray(selected)) {
      for (const file of selected) {
        await editing.importWem(into, file);
      }
    }
    onLeave();
  }

  if (picking === "media") {
    return (
      <MediaPicker
        files={files}
        stream={null}
        current={null}
        onPreview={(candidate) => onPreview(candidate.media)}
        onPick={(candidate) => {
          void editing.edit({
            kind: "addNode",
            parent: into,
            node: { kind: "sound", source: candidate.media.source },
          });
          close();
        }}
        onClose={close}
      />
    );
  }

  if (picking === "existing") {
    return (
      <NodePicker
        revision={editing.revision}
        exclude={exclude}
        onPick={(node) => {
          void editing.edit({ kind: "addNode", parent: into, node: { kind: "existing", node } });
          close();
        }}
        onClose={close}
      />
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <Menu.Root
        open={opening}
        onOpenChange={(next) => {
          onOpening(next);
          if (!next) onLeave();
        }}
      >
        <Tooltip content={m.audio_add_experimental_hint()} side="right">
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                size="xs"
                tabIndex={-1}
                left={<PlusIcon weight="bold" />}
                className="h-5 px-1 text-row font-normal text-surface-300"
                onClick={(event) => event.stopPropagation()}
              >
                {m.audio_add_action()}
              </Button>
            }
          />
        </Tooltip>
        <Menu.Content align="start">
          <Menu.Item icon={<WaveformIcon />} onClick={() => pick("media")}>
            {m.audio_add_sound_action()}
          </Menu.Item>
          <Menu.Item icon={<FileArrowUpIcon />} onClick={() => void importFile()}>
            {m.audio_add_file_action()}
          </Menu.Item>
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger icon={<FolderSimplePlusIcon />}>
              {m.audio_add_container_action()}
            </Menu.SubmenuTrigger>
            <Menu.SubmenuContent>
              {CONTAINERS.map(({ kind, icon: Icon, label }) => (
                <Menu.Item
                  key={kind}
                  icon={<Icon />}
                  onClick={() =>
                    void editing.edit({
                      kind: "addNode",
                      parent: into,
                      node: { kind: "container", container: kind },
                    })
                  }
                >
                  {label()}
                </Menu.Item>
              ))}
            </Menu.SubmenuContent>
          </Menu.SubmenuRoot>
          <Menu.Item icon={<ArrowsInIcon />} onClick={() => pick("existing")}>
            {into.kind === "event" ? m.audio_add_play_existing_action() : m.audio_add_move_action()}
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </span>
  );
}
