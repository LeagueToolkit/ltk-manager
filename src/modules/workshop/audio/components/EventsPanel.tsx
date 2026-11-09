import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AlertBox,
  Code,
  ContextMenu,
  EmptyState,
  Inline,
  LoadingState,
  SearchField,
  Stack,
  useConfirm,
  useToast,
} from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { errorSummary, m } from "@/i18n";
import { useAssetVersion } from "@/lib/assetVersions";
import {
  api,
  type AssetRef,
  type AudioEventResponse,
  type AudioEventsResponse,
  type BankEdit,
  type ContainerKind,
  type MediaReplacement,
  type NodeParent,
  type ObjectProperties,
} from "@/lib/tauri";
import { useAudioInspector, useSetAudioInspector } from "@/stores";

import { useSandbox } from "../../sandbox/state/SandboxContext";
import { audioQueries } from "../api/queries";
import type { BankDocument } from "../hooks/useBankDocument";
import { useEventPlayer, usePlayerMix } from "../hooks/useEventPlayer";
import { useTreePicks } from "../hooks/useTreePicks";
import { NodeNamesContext } from "../state/nodeNames";
import { usePanelCommands } from "../state/panelCommands";
import { useBankEventRequest, useBankEventStore } from "../state/voiceLines";
import type { DropAction } from "../utils/dropTargets";
import {
  addKey,
  eventKey,
  eventLabel,
  eventVoices,
  type EventVoice,
  filterEvents,
  nodeVoices,
  type RandomSource,
  sortEvents,
  type TreeState,
} from "../utils/eventTree";
import { shortcutOf } from "../utils/keymap";
import {
  asksBeforeReplace,
  type FormatChange,
  formatChanges,
  REPLACE_EXTENSIONS,
} from "../utils/mediaReplace";
import {
  deleteEdit,
  duplicateEdit,
  type NodeTarget,
  pasteEdit,
  propertyEdit,
  takesProperty,
  wrapEdit,
} from "../utils/nodeBatch";
import type { FieldTarget } from "../utils/nodeFields";
import { nodeNames, withActions } from "../utils/nodeNames";
import { isEditable, type TreeEditing, voiceTarget } from "../utils/treeEditing";
import { menuSubject, voiceSelection } from "../utils/viewRows";
import { PLAIN_PATH } from "../utils/voiceMix";
import { replayOf, stepAncestors, type TreeItem, type VoiceRow, voiceRows } from "../utils/voices";
import { AudioPanelTools } from "./AudioToolbar";
import { EventMenu, type NodeActions } from "./EventMenu";
import { NewEventEntry, type Naming } from "./NewEventEntry";
import { NoticeBand } from "./NoticeBand";
import { VoiceInspector } from "./VoiceInspector";
import { VoiceList } from "./VoiceList";
import { EventWaveform } from "./Waveform";
import { VoiceRowThumbnail } from "./WaveformThumbnail";

interface EventsPanelProps {
  readonly asset: AssetRef;
  /** The bank held open for edits by the document, which every read applies. */
  readonly bank: BankDocument;
  /** The source that a random container picks a child with. */
  readonly random?: RandomSource;
}

/** The sounds and containers that a cut holds for a paste, and the keys of their rows. */
interface CutNodes {
  readonly targets: readonly NodeTarget[];
  readonly keys: ReadonlySet<string>;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** The most events that Expand all opens, since each open event reads its tree. */
export const EXPAND_ALL_LIMIT = 200;

/**
 * The Events view of an event bank: its tools in the document toolbar, the notices about its
 * bank set, and the event tree with one player.
 *
 * An event's tree is fetched when the event expands or plays. The picked rows take the node
 * actions and the knob edits together. Per "Event tree", "Editing", "New objects" and
 * "Selection" in docs/ux/AUDIO.md.
 */
export function EventsPanel({ asset, bank, random = Math.random }: EventsPanelProps) {
  const sandbox = useSandbox();
  const version = useAssetVersion(asset);
  const queryClient = useQueryClient();
  const revision = bank.revision;
  const events = useQuery(audioQueries.events(sandbox, asset, version, revision));
  const player = useEventPlayer();
  const copy = useCopyToClipboard();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const [cut, setCut] = useState<CutNodes | null>(null);
  const [mediaRequest, setMediaRequest] = useState<string | null>(null);
  const filterBox = useRef<HTMLInputElement>(null);
  const inspecting = useAudioInspector();
  const setInspecting = useSetAudioInspector();

  const imported = bank.state?.imported;
  const names = useMemo(
    () => nodeNames(events.data?.list.events ?? [], imported),
    [events.data, imported],
  );
  const listed = useMemo(
    () => sortEvents(filterEvents(events.data?.list.events ?? [], filter, names)),
    [events.data, filter, names],
  );
  const openEvents = listed.filter((event) => expanded.has(eventKey(event.id)));
  const trees = useQueries({
    queries: openEvents.map((event) =>
      audioQueries.event(sandbox, asset, version, event.id, revision),
    ),
  });

  /* The knob edits of a selection read the picks through a ref, because the picks are read off
     the rows, which the editing builds. */
  const pickedTargets = useRef<readonly NodeTarget[]>([]);
  const editing = useTreeEditing(bank, trees, pickedTargets);

  const treeStates = new Map<number, TreeState>();
  openEvents.forEach((event, index) => {
    const query = trees[index];
    if (query?.data) {
      treeStates.set(event.id, { kind: "ready", tree: query.data.tree });
    } else if (query?.error) {
      treeStates.set(event.id, { kind: "failed", message: errorSummary(query.error) });
    }
  });
  const shownNames = withActions(
    names,
    trees.flatMap((query) => (query.data ? [query.data.tree] : [])),
  );

  const shownProperties = editing?.properties ?? properties(trees);
  usePlayerMix(player, shownProperties);
  const rows = voiceRows(listed, expanded, treeStates, {
    properties: shownProperties,
    editable: editing !== null,
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const targetByKey = new Map<string, NodeTarget>();
  for (const row of rows) {
    const target = voiceTarget(row);
    if (target !== null) targetByKey.set(row.key, target);
  }
  const picks = useTreePicks(targetByKey, selected, setSelected);
  pickedTargets.current = picks.targets;
  /* "Show in bank" and "Create event..." of the Voice lines view, per "Linking the views" in
     docs/ux/CONTEXTUAL_VOICE.md. A create waits for the document to take edits. */
  const bankRequest = useBankEventRequest(asset);
  const settleBankRequest = useBankEventStore((state) => state.settle);
  const [reveal, setReveal] = useState<{ key: string; token: number } | null>(null);
  const editable = editing !== null;
  const listedEvents = events.data !== undefined;
  useEffect(() => {
    if (bankRequest === null) return;

    const { intent, serial } = bankRequest;
    if (intent.kind === "create") {
      if (!editable) return;
      settleBankRequest(serial);
      setNaming({ copyOf: null, initial: intent.name });
      return;
    }
    if (!listedEvents) return;

    settleBankRequest(serial);
    const key = eventKey(intent.event);
    setFilter("");
    setSelected(key);
    setReveal({ key, token: serial });
  }, [bankRequest, editable, listedEvents, settleBankRequest]);

  const eventsById = useMemo(
    () => new Map((events.data?.list.events ?? []).map((event) => [event.id, event])),
    [events.data],
  );

  function expand(key: string, open: boolean) {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /** Opens the add row that Add on `key` reaches: the nearest one above it, else the event's. */
  function openAdd(key: string) {
    const row = byKey.get(key);
    if (row === undefined) return;

    const added = addOf(row);
    expand(eventKey(row.eventId), true);
    setSelected(added);
    setAdding(added);
  }

  /** Returns the key of the add row that Add on `row` reaches. */
  function addOf(row: VoiceRow): string {
    return row.kind === "add" ? row.key : nearestAdd(row);
  }

  /** Returns what the add row that Add on `key` reaches adds into, or null for no row. */
  function addParent(key: string | null): NodeParent | null {
    const row = key === null ? undefined : byKey.get(key);
    if (row === undefined) return null;

    const add = byKey.get(addOf(row));
    return add?.kind === "add" ? add.into : { kind: "event", event: row.eventId };
  }

  function nearestAdd(row: VoiceRow): string {
    let holder: VoiceRow | undefined = row;
    while (holder !== undefined && holder.kind !== "event") {
      const add = byKey.get(addKey(holder.key));
      if (add !== undefined) return add.key;

      holder = holder.parent === null ? undefined : byKey.get(holder.parent);
    }
    return addKey(eventKey(row.eventId));
  }

  /** Returns the voices of one press on `row`, under the containers above it. */
  async function rowVoices(row: VoiceRow): Promise<EventVoice[]> {
    if (row.kind === "event") {
      if (row.event.mediaCount === 0) return [];

      const { tree } = await queryClient.fetchQuery(
        audioQueries.event(sandbox, asset, version, row.event.id, revision),
      );
      return eventVoices(tree, random);
    }
    if (row.kind === "voice") return itemVoices({ kind: "voice", voice: row.line.voice });
    if (row.kind === "group") return itemVoices({ kind: "group", group: row.group });

    return [];
  }

  /** Returns the voices of one press on `item`, under the containers above it. */
  function itemVoices(item: TreeItem): EventVoice[] {
    if (item.kind === "voice") {
      return nodeVoices(item.voice.node, random, stepAncestors(item.voice.path));
    }
    if (item.kind === "action") return [];

    const { group } = item;
    if (group.container !== null) {
      return nodeVoices(group.container, random, stepAncestors(group.path));
    }
    return group.items.flatMap(itemVoices);
  }

  function playRow(row: VoiceRow) {
    const together = picks.picked.size > 1 && picks.picked.has(row.key);
    const shown = together ? rows.filter((each) => picks.picked.has(each.key)) : [row];
    void Promise.all(shown.map(rowVoices)).then((each) => {
      const voicesPlayed = each.flat();
      if (voicesPlayed.length > 0) player.play(row.key, voicesPlayed);
    });
  }

  /* The read of an edited bank lands after the edit resolves, so an event replays from a read of
     the document rather than from the query of the revision before the edit. A voice that plays
     with the edited object follows the edit live and does not restart. */
  async function replay(row: VoiceRow) {
    const what = replayOf(row);
    if (what === null || player.channel.reaches(what.object)) return;

    if (what.kind === "voice") {
      player.play(what.key, [{ media: what.media, path: what.path }]);
      return;
    }

    const answer = await api.readAudioEvent(sandbox, asset, what.event, revision?.id ?? null);
    if (answer.ok) player.play(what.key, eventVoices(answer.value.tree, random));
  }

  /** Copies the names of the picked events and the IDs of the other picked objects. */
  function copyPicks() {
    const targets = picks.targets;
    if (targets.length === 0) return;

    const text = targets
      .map((target) => {
        const event = target.kind === "event" ? eventsById.get(target.object) : undefined;
        return event === undefined ? String(target.object) : eventLabel(event);
      })
      .join("\n");
    const only = targets.length === 1 ? targets[0] : undefined;
    const label = only?.kind === "event" ? m.audio_event_name_label() : m.audio_object_id_label();
    void copy(text, label);
  }

  /** Returns the actions of the picked rows, or null while the bank takes no edit. */
  function nodeActions(): NodeActions | null {
    if (editing === null) return null;

    const targets = picks.targets.filter(
      (target) =>
        target.kind === "event" || target.kind === "action" || isEditable(editing, target.object),
    );
    const removal = deleteEdit(targets);
    const copies = duplicateEdit(targets);
    const only = targets.length === 1 ? targets[0] : undefined;
    const copiedEvent = only?.kind === "event" ? eventsById.get(only.object) : undefined;
    const wraps = (kind: ContainerKind) => wrapEdit(targets, kind);
    const cursor = selected;

    return {
      add: cursor === null ? null : () => openAdd(cursor),
      duplicate:
        copiedEvent !== undefined
          ? () => setNaming({ copyOf: copiedEvent.id, initial: `${eventLabel(copiedEvent)}_copy` })
          : copies === null
            ? null
            : () => void editing.edit(copies),
      alias:
        copiedEvent !== undefined
          ? () =>
              setNaming({
                copyOf: null,
                aliasOf: copiedEvent.id,
                initial: `${eventLabel(copiedEvent)}_alias`,
              })
          : null,
      wrap:
        wraps("random") === null
          ? null
          : (kind) => {
              const edit = wraps(kind);
              if (edit !== null) void editing.edit(edit);
            },
      remove: removal === null ? null : () => void editing.edit(removal),
      copy: copyPicks,
      rename:
        copiedEvent === undefined
          ? null
          : (event) => setNaming({ copyOf: null, renames: event.id, initial: eventLabel(event) }),
      replace: only?.kind === "sound" ? (source) => void replaceMedia(source) : null,
      cut: cutOf(targets),
      paste: pasteInto(),
    };
  }

  /** Returns the cut of the picked sounds and containers that sit in a container, or null. */
  function cutOf(targets: readonly NodeTarget[]): (() => void) | null {
    const movable = targets.filter(
      (target) =>
        (target.kind === "sound" || target.kind === "container") &&
        target.parentKind === "container",
    );
    if (movable.length === 0) return null;

    return () => {
      const keys = new Set(
        [...picks.picked].filter((key) => {
          const target = targetByKey.get(key);
          return target !== undefined && movable.includes(target);
        }),
      );
      setCut({ targets: movable, keys });
      toast.info(m.audio_cut_done_label({ count: movable.length, key: shortcutOf("paste") ?? "" }));
    };
  }

  /**
   * Returns the paste of the cut nodes into the selected container, or into the container of the
   * selected row, or null if no cut waits or no container takes it.
   */
  function pasteInto(): (() => void) | null {
    const at = selected === null ? undefined : targetByKey.get(selected);
    if (cut === null || editing === null || at === undefined) return null;

    const into =
      at.kind === "container" ? at.object : at.parentKind === "container" ? at.parent : null;
    const edit = into === null ? null : pasteEdit(cut.targets, into, at.ancestors);
    if (edit === null || into === null || !isEditable(editing, into)) return null;

    return () => {
      void editing.edit(edit).then((applied) => {
        if (applied) setCut(null);
      });
    };
  }

  /**
   * Replaces the media `source` with `file`, or with a file the reader picks, after a confirm if
   * several sounds share the media or its format changes. Per "Replacing media" in
   * docs/ux/AUDIO.md.
   */
  async function replaceMedia(source: number, file: string | null = null) {
    const picked =
      file ??
      (await open({
        multiple: false,
        directory: false,
        title: m.audio_replace_file_title(),
        filters: [
          { name: m.audio_replace_file_filter_label(), extensions: [...REPLACE_EXTENSIONS] },
        ],
      }));
    if (typeof picked !== "string") return;

    const replacement = await bank.previewReplace(source, picked);
    if (replacement === null) return;
    if (asksBeforeReplace(replacement) && !(await confirm(replaceQuestion(replacement)))) return;

    await bank.replaceMedia(source, picked);
  }

  /** Runs a drop of a file on a row: a replacement of a sound's media, or an import. */
  function dropFile(action: DropAction) {
    if (action.kind === "replace") void replaceMedia(action.source, action.file);
    if (action.kind === "import" && editing !== null)
      void editing.importWem(action.into, action.file);
  }

  const actions = nodeActions();
  const wrap = actions?.wrap ?? null;
  const selectedRow = selected === null ? undefined : byKey.get(selected);
  const subject = selectedRow === undefined ? null : menuSubject(selectedRow);
  const pickedEvent =
    picks.targets.length === 1 && subject?.kind === "event" ? subject.event : null;
  const pickedSource =
    picks.targets.length === 1 && subject?.kind === "node" && subject.node.kind === "sound"
      ? subject.node.source
      : null;
  const into = editing === null ? null : addParent(selected);
  const head =
    selectedRow === undefined
      ? undefined
      : rows.find((row) => row.kind === "event" && row.eventId === selectedRow.eventId);

  /** Adds an empty container of `kind` where the add row of the selected row adds. */
  const addContainer = (kind: ContainerKind) =>
    editing === null || into === null
      ? undefined
      : () =>
          void editing.edit({
            kind: "addNode",
            parent: into,
            node: { kind: "container", container: kind },
          });

  usePanelCommands("events", {
    toggleInspector: () => setInspecting(!inspecting),
    find: () => filterBox.current?.select(),
    stop: player.playing === null ? undefined : player.stop,
    play: selectedRow === undefined ? undefined : () => togglePlay(selectedRow),
    playAll: head === undefined ? undefined : () => playRow(head),
    selectAll: listed.length === 0 ? undefined : picks.pickAll,
    expandAll: listed.length === 0 || listed.length > EXPAND_ALL_LIMIT ? undefined : expandEvents,
    collapseAll: expanded.size === 0 ? undefined : () => setExpanded(new Set()),
    copy: picks.targets.length > 0 ? copyPicks : undefined,
    add: actions?.add ?? undefined,
    duplicate: actions?.duplicate ?? undefined,
    remove: actions?.remove ?? undefined,
    wrap: wrap === null ? undefined : () => wrap("random"),
    cut: actions?.cut ?? undefined,
    paste: actions?.paste ?? undefined,
    rename:
      actions?.rename == null || pickedEvent === null
        ? undefined
        : () => actions.rename?.(pickedEvent),
    replaceMedia:
      actions?.replace == null || pickedSource === null
        ? undefined
        : () => actions.replace?.(pickedSource),
    newEvent: editing === null ? undefined : () => setNaming({ copyOf: null, initial: "" }),
    addSound: selected === null || into === null ? undefined : () => requestMedia(selected),
    addRandom: addContainer("random"),
    addSequence: addContainer("sequence"),
    addSwitch: addContainer("switch"),
    importWem: editing === null || into === null ? undefined : () => void importInto(into),
  });

  /** Plays `row`, or stops it if it plays. */
  function togglePlay(row: VoiceRow) {
    if (player.playing === row.key) player.stop();
    else playRow(row);
  }

  /** Expands every listed event. */
  function expandEvents() {
    setExpanded((current) => new Set([...current, ...listed.map((event) => eventKey(event.id))]));
  }

  /** Opens the add row that Add on `key` reaches with its media picker. */
  function requestMedia(key: string) {
    const row = byKey.get(key);
    if (row === undefined) return;

    const added = addOf(row);
    expand(eventKey(row.eventId), true);
    setSelected(added);
    setMediaRequest(added);
  }

  /** Imports WEMs that the reader picks into `parent`, as From file of an add row does. */
  async function importInto(parent: NodeParent) {
    const selected = await open({
      multiple: true,
      directory: false,
      title: m.audio_add_file_title(),
      filters: [{ name: m.audio_add_file_filter_label(), extensions: ["wem"] }],
    });
    if (editing === null || selected === null) return;

    if (typeof selected === "string") {
      await editing.importWem(parent, selected);
    } else if (Array.isArray(selected)) {
      for (const file of selected) {
        await editing.importWem(parent, file);
      }
    }
  }

  const announcement =
    player.playing === null ? m.audio_stopped_label() : m.audio_event_playing_label();
  const count = countLabel(picks.picked.size, events.data?.list.events.length);

  const tools = (
    <AudioPanelTools
      filter={
        <SearchField
          value={filter}
          onChange={setFilter}
          inputRef={filterBox}
          label={m.audio_events_filter_label()}
          clearLabel={m.audio_filter_clear_label()}
        />
      }
      count={count}
      entry={
        editing !== null && (
          <NewEventEntry
            naming={naming}
            onNaming={setNaming}
            onCommit={(name, entry) => editing.edit(namingEdit(name, entry))}
          />
        )
      }
    />
  );
  if (events.error) {
    return (
      <>
        {tools}
        <EmptyState size="sm" title={m.audio_events_failed_empty()} />
      </>
    );
  }
  if (events.data === undefined) {
    return (
      <>
        {tools}
        <LoadingState />
      </>
    );
  }

  const files = events.data.list.files;
  return (
    <NodeNamesContext value={shownNames}>
      <Stack fill>
        {tools}
        <SetNotices response={events.data} />
        {bank.state !== null && !bank.state.editable && (
          <NoticeBand>
            <AlertBox tone="info">
              {m.audio_edit_legacy_description({ version: String(bank.state.version) })}
            </AlertBox>
          </NoticeBand>
        )}
        {events.data.list.events.length === 0 && (
          <EmptyState size="sm" title={m.audio_events_empty()} />
        )}
        {events.data.list.events.length > 0 && listed.length === 0 && (
          <EmptyState size="sm" title={m.audio_events_filtered_empty()} />
        )}
        {listed.length > 0 && (
          <Inline fill align="stretch">
            <VoiceList
              rows={rows}
              onExpand={expand}
              selected={selected}
              picks={picks}
              player={player}
              onPlay={playRow}
              onReplay={(row) => void replay(row)}
              onPreview={(key, media) => player.play(key, [{ media, path: PLAIN_PATH }])}
              onCopy={copyPicks}
              actions={actions}
              adding={adding}
              onAdding={setAdding}
              mediaRequest={mediaRequest}
              onMediaRequestTaken={() => setMediaRequest(null)}
              editing={editing}
              files={files}
              reveal={reveal}
              cut={cut?.keys ?? NO_KEYS}
              onDropAction={dropFile}
              menu={(row) => {
                const subject = menuSubject(row);
                if (subject === null) return null;

                return (
                  <>
                    <EventMenu
                      subject={subject}
                      actions={actions}
                      count={picks.targets.length}
                      onCopy={copyPicks}
                    />
                    {row.kind === "group" && !inspecting && (
                      <ContextMenu.Item
                        icon={<SidebarSimpleIcon mirrored />}
                        onClick={() => setInspecting(true)}
                      >
                        {m.audio_inspector_show_action()}
                      </ContextMenu.Item>
                    )}
                  </>
                );
              }}
              thumbnail={(row) => (
                <VoiceRowThumbnail
                  asset={asset}
                  version={version}
                  row={row}
                  playing={player.playing === row.key}
                />
              )}
            />
            {inspecting && (
              <VoiceInspector
                subjects={inspected(rows, selected, picks.picked)}
                byKey={byKey}
                properties={shownProperties}
                editing={editing}
                onReplay={(row) => void replay(row)}
              />
            )}
          </Inline>
        )}
        {listed.length > 0 && (
          <EventWaveform player={player} selection={voiceSelection(rows, selected)} />
        )}
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>
      </Stack>
    </NodeNamesContext>
  );
}

/**
 * Returns the rows that the inspector shows: the picked voice and header rows in draw order if
 * there are several, else the selected row.
 */
function inspected(
  rows: readonly VoiceRow[],
  selected: string | null,
  picked: ReadonlySet<string>,
): VoiceRow[] {
  if (picked.size > 1) {
    return rows.filter(
      (row) => picked.has(row.key) && (row.kind === "voice" || row.kind === "group"),
    );
  }

  const row = rows.find((each) => each.key === selected);
  return row === undefined ? [] : [row];
}

/**
 * Returns what the tree edits through while `bank` is open and takes edits, with the properties
 * of the objects of `trees`, and null otherwise.
 *
 * A property edit of a picked object applies to every picked object that takes the property, as
 * `propertyEdit` maps it, and a knob locks while one of the picks does not take its property.
 */
function useTreeEditing(
  bank: BankDocument,
  trees: readonly { readonly data?: AudioEventResponse }[],
  picked: { readonly current: readonly NodeTarget[] },
): TreeEditing | null {
  const { state, revision, edit, importWem } = bank;
  const edited = useMemo(() => new Set(state?.edited ?? []), [state?.edited]);
  const read = properties(trees);
  const latest = useRef(read);
  latest.current = read;

  const editPicked = useCallback(
    (change: BankEdit) => {
      const targets = picked.current;
      const batched =
        change.kind === "property" &&
        change.value !== null &&
        targets.length > 1 &&
        targets.some((target) => target.object === change.object);
      if (!batched || change.kind !== "property" || change.value === null) return edit(change);

      const after = change.value;
      const before =
        latest.current.get(change.object)?.values.find((each) => each.property === change.property)
          ?.value ?? after;
      const batch = propertyEdit(
        targets,
        change.property,
        change.object,
        before,
        after,
        latest.current,
      );
      return edit(batch ?? change);
    },
    [edit, picked],
  );

  const locked = useCallback(
    (target: FieldTarget) => {
      const targets = picked.current;
      if (target.kind !== "property" || targets.length < 2) return false;
      if (!targets.some((each) => each.object === target.object)) return false;

      return !takesProperty(targets, target.property);
    },
    [picked],
  );

  if (state === null || revision === null || !state.editable) return null;

  return { revision, properties: read, edited, edit: editPicked, importWem, locked };
}

/** Returns the properties of the objects of `trees`, by object ID. */
function properties(
  trees: readonly { readonly data?: AudioEventResponse }[],
): Map<number, ObjectProperties> {
  const byId = new Map<number, ObjectProperties>();
  for (const tree of trees) {
    for (const object of tree.data?.properties ?? []) byId.set(object.id, object);
  }
  return byId;
}

/** The notices about the bank set: the game's index, the fallback set and the missing files. */
function SetNotices({ response }: { response: AudioEventsResponse }) {
  const { list, index } = response;
  const missing = list.files.filter((file, at) => at > 0 && file.state.kind === "missing");
  const missingShown = list.origin === "units" && missing.length > 0;
  const shown = index.status !== "ready" || list.origin !== "units" || missingShown;
  if (!shown) return null;

  return (
    <NoticeBand>
      {index.status === "building" && (
        <AlertBox tone="info">{m.audio_events_index_building_description()}</AlertBox>
      )}
      {index.status === "failed" && (
        <AlertBox tone="warning" title={m.audio_events_index_failed_title()}>
          <span className="select-text">{index.message}</span>
        </AlertBox>
      )}
      {list.origin === "siblings" && (
        <AlertBox tone="info">{m.audio_events_siblings_description()}</AlertBox>
      )}
      {list.origin === "alone" && (
        <AlertBox tone="info">{m.audio_events_alone_description()}</AlertBox>
      )}
      {missingShown && (
        <AlertBox tone="warning" title={m.audio_events_files_missing_title()}>
          <Stack as="span" gap={0.5} align="start">
            {missing.map((file) => (
              <Code key={file.path} className="select-text">
                {file.path}
              </Code>
            ))}
          </Stack>
        </AlertBox>
      )}
    </NoticeBand>
  );
}

/** Returns the count of the toolbar: the picked rows if several are, else the events. */
function countLabel(picked: number, total: number | undefined): string | undefined {
  if (picked > 1) return m.audio_selection_count_label({ count: picked });
  if (total === undefined) return undefined;

  return m.audio_events_total_label({ count: total });
}

/** Returns the edit that the name entry commits: a new event, an alias, a copy or a rename. */
function namingEdit(name: string, naming: Naming): BankEdit {
  if (naming.renames != null) return { kind: "renameEvent", event: naming.renames, name };
  if (naming.aliasOf != null) return { kind: "aliasEvent", event: naming.aliasOf, name };
  if (naming.copyOf !== null) return { kind: "copyEvent", event: naming.copyOf, name };
  return { kind: "newEvent", name };
}

const FORMAT_CHANGE_LABELS: Record<FormatChange, () => string> = {
  codec: m.audio_replace_change_codec_label,
  channels: m.audio_replace_change_channels_label,
  rate: m.audio_replace_change_rate_label,
};

/** The confirm of a replacement whose media several sounds share or whose format changes. */
function replaceQuestion(replacement: MediaReplacement) {
  const changes = formatChanges(replacement);
  const elsewhere = replacement.sounds.filter((sound) => !sound.opened).length;

  return {
    title: m.audio_replace_confirm_title(),
    heading: m.audio_replace_confirm_heading({ count: replacement.sounds.length }),
    description: (
      <Stack as="span" gap={1} align="start">
        {changes.length > 0 && (
          <span>
            {m.audio_replace_confirm_format_description({
              changes: changes.map((change) => FORMAT_CHANGE_LABELS[change]()).join(", "),
            })}
          </span>
        )}
        {elsewhere > 0 && (
          <span>{m.audio_replace_confirm_elsewhere_description({ count: elsewhere })}</span>
        )}
        <span className="flex flex-wrap gap-1 select-text">
          {replacement.sounds.map((sound) => (
            <Code key={sound.id}>{m.audio_replace_sound_label({ id: String(sound.id) })}</Code>
          ))}
        </span>
      </Stack>
    ),
    confirmLabel: m.audio_replace_confirm_action(),
    tone: "warning" as const,
  };
}
