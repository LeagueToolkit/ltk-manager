import { useQuery } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useCallback, useMemo, useRef, useState } from "react";

import {
  AlertBox,
  Code,
  EmptyState,
  LoadingState,
  Popover,
  Properties,
  Property,
  SearchField,
  Stack,
  Tabs,
} from "@/components";
import { m } from "@/i18n";
import { useAssetVersion } from "@/lib/assetVersions";
import type { AssetRef, AudioContainer, AudioInfo, MediaRow } from "@/lib/tauri";
import { openKeySheet } from "@/modules/keys";
import { useAudioInspector } from "@/stores";
import { formatBytes } from "@/utils/formatBytes";

import { useAssetInfo } from "../../preview/api/useAssetInfo";
import { useSandbox } from "../../sandbox/state/SandboxContext";
import { DocumentFrame } from "../../shared/components/DocumentFrame";
import { audioQueries } from "../api/queries";
import { useAudioCommands, usePanelHub } from "../hooks/useAudioCommands";
import { type BankDocument, useBankDocument } from "../hooks/useBankDocument";
import { useMediaActions } from "../hooks/useMediaActions";
import { useMediaPlayer } from "../hooks/useMediaPlayer";
import { useMediaFocus } from "../state/mediaFocus";
import { type PanelCommands, PanelCommandsContext, usePanelCommands } from "../state/panelCommands";
import { useNudgeVolume, usePreviewRepeat, useToggleLoop } from "../state/previewTransport";
import { AUDIO_KEYMAP, type AudioCommandId, type AudioSurface } from "../utils/keymap";
import { filterRows, type MediaSort, sortRows } from "../utils/mediaRows";
import type { PickMode } from "../utils/rowSelection";
import { AudioMenubar, VolumeReadout } from "./AudioMenubar";
import { AudioPanelTools, AudioToolbar, AudioToolsSlotContext } from "./AudioToolbar";
import { BankUnitItems } from "./BankUnits";
import { EventsPanel, EXPAND_ALL_LIMIT } from "./EventsPanel";
import { MediaTable } from "./MediaTable";
import { NoticeBand } from "./NoticeBand";
import { MediaWaveform } from "./Waveform";

interface AudioFileDocumentProps {
  readonly asset: AssetRef;
  /** The file name, which the document resolved. A reference may contain a hash. */
  readonly name: string;
  /** The id of the tab, which takes the unsaved dot and the undo keys of an event bank. */
  readonly documentId?: string | null;
  /** This document is the one on screen. Only the active document's toolbar shows. */
  readonly active: boolean;
  /** The menu items of the tab that move the file out, listed in the File menu. */
  readonly fileActions?: ReactNode;
}

/** The two panels of a bank with a hierarchy. */
type AudioView = "media" | "events";

const CONTAINER_LABELS: Record<AudioContainer, () => string> = {
  package: m.audio_container_package_label,
  bank: m.audio_container_bank_label,
  media: m.audio_container_media_label,
};

/** The surfaces of a bank with a hierarchy, whose menus list the event tree's commands. */
const BANK_SURFACES: readonly AudioSurface[] = ["media", "voices", "document"];

/** The surfaces of a file without a hierarchy. */
const MEDIA_SURFACES: readonly AudioSurface[] = ["media", "document"];

/** The commands of a bank's edits, which a file without a hierarchy never takes. */
const BANK_COMMANDS: readonly AudioCommandId[] = ["save", "undo", "redo"];

/** The commands of the event tree that only its keys run, which the menus leave out. */
const KEY_ONLY_COMMANDS: readonly AudioCommandId[] = ["moveUp", "moveDown"];

/**
 * A Wwise package, bank or WEM: the menu bar and the view tools in one row, the notices about the
 * file, and the table of its media.
 *
 * A bank with a hierarchy adds an Events view with the event tree, which opens first in a bank
 * without media. A "Show media" request for the file switches to the Media view. The `BKHD`
 * facts open from the File menu. Per "The audio file document" in docs/ux/AUDIO.md.
 */
export function AudioFileDocument({
  asset,
  name,
  documentId = null,
  active,
  fileActions = null,
}: AudioFileDocumentProps) {
  const info = useAssetInfo(asset);
  const audio = info.data?.kind === "audio" ? info.data : null;
  const hierarchy = audio?.bank?.eventCount != null;
  const bank = useBankDocument(asset, documentId, hierarchy);
  const focus = useMediaFocus(asset);
  const [view, setView] = useState<AudioView | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [tools, setTools] = useState<HTMLSpanElement | null>(null);
  const [details, setDetails] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const shownView: AudioView = hierarchy ? (view ?? defaultView(audio)) : "media";
  const toggleLoop = useToggleLoop();
  const nudgeVolume = useNudgeVolume();
  const looping = usePreviewRepeat() === "loop";
  const inspecting = useAudioInspector();
  const editable = bank.state?.editable === true;
  const { hub, panels } = usePanelHub();

  if (focus !== null && focus.serial !== focused) {
    setFocused(focus.serial);
    setView("media");
  }

  /** The commands that the document runs itself, each absent where it does not apply now. */
  const own: PanelCommands = {
    loop: toggleLoop,
    volumeDown: () => nudgeVolume(-1),
    volumeUp: () => nudgeVolume(1),
    help: () => openKeySheet(frame.current),
    details: audio === null ? undefined : () => setDetails(true),
    viewMedia: hierarchy ? () => setView("media") : undefined,
    viewEvents: hierarchy ? () => setView("events") : undefined,
    save:
      editable && bank.state?.dirty === true ? () => void bank.save().catch(() => {}) : undefined,
    undo: editable && bank.history.undo > 0 ? () => void bank.step("undo") : undefined,
    redo: editable && bank.history.redo > 0 ? () => void bank.step("redo") : undefined,
  };
  const commands: PanelCommands = { ...panels[shownView], ...own };

  const handleKeyDown = useAudioCommands(documentId, commands);
  const detailsLabel =
    audio?.bank != null ? m.audio_details_bank_action() : m.audio_details_file_action();
  const units = audio !== null && audio.container !== "media";

  return (
    <DocumentFrame ref={frame} data-ui="AudioFileDocument" onKeyDown={handleKeyDown}>
      <PanelCommandsContext value={hub}>
        <Tabs.Root
          value={shownView}
          onValueChange={(value) => setView(value as AudioView)}
          className="min-h-0 flex-1"
        >
          <AudioToolbar
            active={active}
            rowRef={row}
            menubar={
              <AudioMenubar
                facts={{
                  surfaces: hierarchy ? BANK_SURFACES : MEDIA_SURFACES,
                  hidden: hierarchy ? KEY_ONLY_COMMANDS : [...BANK_COMMANDS, ...KEY_ONLY_COMMANDS],
                  commands,
                  checked: {
                    viewMedia: shownView === "media",
                    viewEvents: shownView === "events",
                    toggleInspector: inspecting,
                    loop: looping,
                  },
                  reasons: menuReasons(shownView, bank),
                }}
                slots={{
                  fileActions,
                  units: units && <BankUnitItems asset={asset} />,
                  volume: <VolumeReadout />,
                }}
                titles={{ details: detailsLabel }}
                keyScope={frame}
                experimental={editable}
              />
            }
            views={hierarchy && <ViewSwitch />}
            toolsRef={setTools}
          />
          {audio !== null && (
            <DetailsPopover
              audio={audio}
              label={detailsLabel}
              anchor={row}
              open={details}
              onOpenChange={setDetails}
            />
          )}
          {audio !== null && <AudioNotices asset={asset} audio={audio} view={shownView} />}
          <AudioToolsSlotContext value={tools}>
            {!hierarchy && <MediaPanel asset={asset} name={name} />}
            {hierarchy && <ViewPanels asset={asset} name={name} bank={bank} />}
          </AudioToolsSlotContext>
        </Tabs.Root>
      </PanelCommandsContext>
    </DocumentFrame>
  );
}

/**
 * Returns the reasons that the menus show on a disabled command of a bank with a hierarchy.
 *
 * A bank that takes no edits names its version on every edit. In the Media view, a command of the
 * event tree points at the Events view.
 */
function menuReasons(view: AudioView, bank: BankDocument): Partial<Record<AudioCommandId, string>> {
  const reasons: Partial<Record<AudioCommandId, string>> = {};
  const tree = AUDIO_KEYMAP.filter(
    (binding) => binding.surfaces.includes("voices") && !binding.surfaces.includes("media"),
  );

  if (view === "media") {
    for (const binding of tree) reasons[binding.id] = m.audio_menu_events_view_reason();
  }
  if (view === "events") Object.assign(reasons, pickReasons());
  if (bank.state !== null && !bank.state.editable) {
    const refused = m.audio_menu_no_edits_reason({ version: String(bank.state.version) });
    for (const binding of tree) {
      if (binding.group === "editing") reasons[binding.id] = refused;
    }
    for (const id of BANK_COMMANDS) reasons[id] = refused;
  }

  return reasons;
}

/** The reasons of the commands of the event tree that wait for a pick, in the Events view. */
function pickReasons(): Partial<Record<AudioCommandId, string>> {
  const row = m.audio_menu_select_row_reason();
  const event = m.audio_menu_one_event_reason();

  return {
    rename: event,
    replaceMedia: m.audio_menu_one_sound_reason(),
    paste: m.audio_menu_paste_reason(),
    add: row,
    addSound: row,
    addRandom: row,
    addSequence: row,
    addSwitch: row,
    importWem: row,
    duplicate: row,
    wrap: row,
    cut: row,
    remove: row,
    copy: row,
    play: row,
    playAll: row,
    expandAll: m.audio_menu_expand_limit_reason({ count: String(EXPAND_ALL_LIMIT) }),
  };
}

/** Returns the view that a bank with a hierarchy opens on: Events if it holds no media. */
function defaultView(audio: AudioInfo | null): AudioView {
  return audio?.mediaCount === 0 ? "events" : "media";
}

/** The Media and Events switch of a bank with a hierarchy. */
function ViewSwitch() {
  return (
    <Tabs.List variant="pills" aria-label={m.audio_views_label()} className="h-7 shrink-0">
      <Tabs.Tab value="media">{m.audio_tab_media_label()}</Tabs.Tab>
      <Tabs.Tab value="events">{m.audio_tab_events_label()}</Tabs.Tab>
    </Tabs.List>
  );
}

interface ViewPanelsProps {
  readonly asset: AssetRef;
  readonly name: string;
  readonly bank: BankDocument;
}

/** The Media and Events panels of a bank with a hierarchy, one shown at a time. */
function ViewPanels({ asset, name, bank }: ViewPanelsProps) {
  return (
    <>
      <Tabs.Panel
        value="media"
        keepMounted
        className="data-[hidden]:hidden flex min-h-0 flex-1 flex-col"
      >
        <MediaPanel asset={asset} name={name} />
      </Tabs.Panel>
      <Tabs.Panel
        value="events"
        keepMounted
        className="data-[hidden]:hidden flex min-h-0 flex-1 flex-col"
      >
        <EventsPanel asset={asset} bank={bank} />
      </Tabs.Panel>
    </>
  );
}

interface DetailsPopoverProps {
  readonly audio: AudioInfo;
  readonly label: string;
  readonly anchor: RefObject<HTMLDivElement | null>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** The popover of Bank details or File details, under the toolbar row. */
function DetailsPopover({ audio, label, anchor, open, onOpenChange }: DetailsPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Content
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={8}
        aria-label={label}
        className="w-64 p-3"
        data-ui="AudioFileDocument:details"
      >
        <Stack gap={2}>
          <Popover.Title>{label}</Popover.Title>
          <FileFacts audio={audio} />
        </Stack>
      </Popover.Content>
    </Popover.Root>
  );
}
/** The `BKHD` facts of a bank, then its size and media count, as label and value rows. */
function FileFacts({ audio }: { audio: AudioInfo }) {
  const bank = audio.bank;

  return (
    <Properties className="text-meta">
      {bank === null && (
        <Property label={m.audio_fact_kind_label()}>{CONTAINER_LABELS[audio.container]()}</Property>
      )}
      {bank !== null && (
        <>
          <Property label={m.audio_fact_version_label()}>
            <Code>{bank.version}</Code>
          </Property>
          <Property label={m.audio_fact_bank_type_label()}>
            <Code>{bank.bankType}</Code>
          </Property>
          <Property label={m.audio_fact_alignment_label()}>
            <Code>{bank.alignment}</Code>
          </Property>
          <Property label={m.audio_fact_header_id_label()}>
            <Code className="select-text">{bank.headerId}</Code>
          </Property>
          {bank.nameId !== null && (
            <Property label={m.audio_fact_name_id_label()}>
              <Code className="select-text">{bank.nameId}</Code>
            </Property>
          )}
        </>
      )}
      <Property label={m.audio_fact_size_label()} className="tabular-nums">
        {formatBytes(audio.sizeBytes)}
      </Property>
      <Property label={m.audio_fact_media_label()} className="tabular-nums">
        {audio.mediaCount}
      </Property>
    </Properties>
  );
}

interface AudioNoticesProps {
  readonly asset: AssetRef;
  readonly audio: AudioInfo;
  readonly view: AudioView;
}

/**
 * The read failure, the rejection, the header ID mismatch and the building audio index of a
 * file, each as a notice.
 *
 * The Events view shows its own notice for the building index, so this one shows in the Media
 * view alone.
 */
function AudioNotices({ asset, audio, view }: AudioNoticesProps) {
  const sandbox = useSandbox();
  const version = useAssetVersion(asset);
  const named = audio.container !== "media";
  const references = useQuery({
    ...audioQueries.references(sandbox, asset, version),
    enabled: named,
  });

  const bank = audio.bank;
  const mismatch = bank !== null && bank.nameId !== null && bank.nameId !== bank.headerId;
  const building = named && view === "media" && references.data?.index.status === "building";
  if (audio.failure === null && bank?.rejection == null && !mismatch && !building) return null;

  return (
    <NoticeBand>
      {audio.failure !== null && (
        <AlertBox tone="danger" title={m.audio_read_failure_title()}>
          <span className="select-text">{audio.failure}</span>
        </AlertBox>
      )}
      {bank?.rejection != null && (
        <AlertBox tone="warning" title={m.audio_rejection_title()}>
          <span className="select-text">{bank.rejection}</span>
        </AlertBox>
      )}
      {mismatch && (
        <AlertBox tone="info">
          {m.audio_id_mismatch_description({
            header: String(bank.headerId),
            name: String(bank.nameId),
          })}
        </AlertBox>
      )}
      {building && <AlertBox tone="info">{m.audio_units_index_building_description()}</AlertBox>}
    </NoticeBand>
  );
}

/** The filter and count in the toolbar, the table of media and the live region that names what plays. */
function MediaPanel({ asset, name }: { asset: AssetRef; name: string }) {
  const version = useAssetVersion(asset);
  const media = useQuery(audioQueries.media(asset, version));
  const player = useMediaPlayer(asset);
  const actions = useMediaActions(asset, name);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<MediaSort | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const focus = useMediaFocus(asset);
  const [focused, setFocused] = useState<number | null>(null);
  const filterBox = useRef<HTMLInputElement>(null);

  if (focus !== null && focus.serial !== focused) {
    setFocused(focus.serial);
    setSelected(focus.source);
    setPicked((current) => new Set([...current, focus.source]));
    setAnchor(focus.source);
    setFilter("");
  }

  const rows = useMemo(
    () => sortRows(filterRows(media.data ?? [], filter), sort),
    [media.data, filter, sort],
  );
  const selectedRow = rows.find((row) => row.sourceId === selected);

  const handleSelect = useCallback(
    (sourceId: number, mode: PickMode) => {
      setSelected(sourceId);
      if (mode === "only") {
        setPicked(new Set([sourceId]));
        setAnchor(sourceId);
        return;
      }
      if (mode === "toggle") {
        setPicked((current) => {
          const next = new Set(current);
          if (next.has(sourceId)) next.delete(sourceId);
          else next.add(sourceId);
          return next;
        });
        setAnchor(sourceId);
        return;
      }
      const order = rows.map((r) => r.sourceId);
      const from = anchor === null ? -1 : order.indexOf(anchor);
      const to = order.indexOf(sourceId);
      if (from === -1 || to === -1) {
        setPicked(new Set([sourceId]));
        setAnchor(sourceId);
        return;
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      const range = order.slice(start, end + 1);
      setPicked((current) => {
        const next = new Set(current);
        for (const id of range) next.add(id);
        return next;
      });
    },
    [anchor, rows],
  );

  const handleSelectAll = useCallback(() => {
    setPicked(new Set(rows.map((r) => r.sourceId)));
  }, [rows]);

  const handleClear = useCallback(() => {
    setSelected(null);
    setPicked(new Set());
    setAnchor(null);
  }, []);

  usePanelCommands("media", {
    find: () => filterBox.current?.select(),
    stop: player.playing === null ? undefined : () => player.channel.stopAll(),
    play:
      selectedRow?.playback.kind === "playable"
        ? () => player.toggle(selectedRow.sourceId)
        : undefined,
    copy: selectedRow === undefined ? undefined : () => actions.copySource(selectedRow),
  });

  const announcement =
    player.playing === null
      ? m.audio_stopped_label()
      : m.audio_playing_label({ source: String(player.playing) });

  return (
    <Stack fill>
      <AudioPanelTools
        filter={
          <SearchField
            value={filter}
            onChange={setFilter}
            inputRef={filterBox}
            label={m.audio_filter_label()}
            clearLabel={m.audio_filter_clear_label()}
          />
        }
        count={media.data && m.audio_media_count_label({ count: media.data.length })}
      />
      <MediaBody
        media={media.data}
        failed={media.error !== null}
        rows={rows}
        filtered={filter.trim() !== ""}
      >
        <MediaTable
          rows={rows}
          sort={sort}
          onSort={setSort}
          selected={selected}
          picked={picked}
          onSelect={handleSelect}
          onSelectAll={handleSelectAll}
          onClear={handleClear}
          player={player}
          actions={actions}
          focusSerial={focused}
        />
      </MediaBody>
      {media.data !== undefined && media.data.length > 0 && (
        <MediaWaveform player={player} rows={media.data} selected={selected} />
      )}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </Stack>
  );
}

interface MediaBodyProps {
  readonly media: MediaRow[] | undefined;
  readonly failed: boolean;
  readonly rows: readonly MediaRow[];
  readonly filtered: boolean;
  readonly children: ReactNode;
}

/** The table, or the state that stands in for it while it reads, fails or is empty. */
function MediaBody({ media, failed, rows, filtered, children }: MediaBodyProps) {
  if (failed) return <EmptyState size="sm" title={m.audio_media_failed_empty()} />;
  if (media === undefined) return <LoadingState />;
  if (media.length === 0) return <EmptyState size="sm" title={m.audio_media_empty()} />;
  if (rows.length === 0 && filtered) {
    return <EmptyState size="sm" title={m.audio_media_filtered_empty()} />;
  }
  return children;
}
