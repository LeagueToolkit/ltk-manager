import { ArchiveIcon } from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  use,
  useRef,
  useState,
} from "react";

import { Combobox, InputDefaultContext, LayerIcon } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { layerTitle } from "../../../documents/utils/contentDocument";
import { fileKindFromPath } from "../../../gameBrowser/utils/fileKind";
import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { describeFileKind } from "../../../shared/utils/fileKindIcon";
import { CutText } from "../../shared/components/CutText";
import { splitPath } from "../../shared/utils/textCut";
import { usePathSuggestions } from "../hooks/usePathSuggestions";
import type { PathField } from "../utils/pathField";
import type { PathGroup, PathGroupId, PathSuggestion } from "../utils/pathSuggestions";

/** Why the field loses focus, when the blur must not commit the draft. */
type Leaving = "discard" | "picked" | null;

interface PathInputProps {
  /** The field's value: the path, or the hex of a chunk no table names. */
  value: string;
  field: PathField;
  placeholder?: string;
  "aria-label"?: string;
  /** The last text the field committed was refused. */
  invalid: boolean;
  /** Focus the field and select its text on mount. */
  autoFocus: boolean;
  onCommit: (text: string) => void;
  /** The field was left, after any commit. */
  onLeave?: () => void;
  /** The field was left by a bare `Enter`, after the commit and `onLeave`. */
  onEnter?: () => void;
}

/**
 * An edit field for a path value, with project and game files suggested below it.
 *
 * "A path field" in docs/ux/BIN_EDITOR.md. The draft is committed like a `Readout` draft, on
 * blur or on `Enter`, and `Escape` discards it. A picked suggestion is committed at once.
 * `Enter` picks the highlighted suggestion: the top one while the draft is search terms, and
 * none while the draft contains `/`, so a typed path is written as typed.
 */
export function PathInput({
  value,
  field,
  placeholder,
  "aria-label": ariaLabel,
  invalid,
  autoFocus,
  onCommit,
  onLeave,
  onEnter,
}: PathInputProps) {
  const implicit = use(InputDefaultContext);
  const [draft, setDraft] = useState<{ text: string; over: string } | null>(null);
  if (draft !== null && draft.over !== value) {
    setDraft(null);
  }

  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const highlighted = useRef<PathSuggestion | undefined>(undefined);
  const leaving = useRef<Leaving>(null);

  const shown = draft?.text ?? (implicit ? "" : value);
  const query = draft === null || draft.text.trim() === "" ? null : draft.text;
  const { groups, more, searching } = usePathSuggestions({ field, value, query, open });
  const autoHighlight = field.enterPicks && query !== null && !query.includes("/");
  const listed = open && (groups.length > 0 || searching);

  function leave() {
    const reason = leaving.current;
    leaving.current = null;
    setOpen(false);

    if (reason === null && draft !== null && (draft.text !== value || implicit)) {
      onCommit(draft.text);
    }

    setDraft(null);
    onLeave?.();
  }

  function pick(suggestion: PathSuggestion | null, byKey: boolean) {
    if (suggestion === null) return;

    leaving.current = "picked";
    if (suggestion.path !== value || implicit) onCommit(suggestion.path);
    input.current?.blur();

    if (byKey) onEnter?.();
  }

  function keys(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      /* The combobox selects the highlighted suggestion, and `pick` then blurs the field. */
      if (listed && isListed(groups, highlighted.current)) return;

      event.preventDefault();
      event.currentTarget.blur();
      if (!event.ctrlKey && !event.metaKey) onEnter?.();
    }

    if (event.key === "Escape") {
      leaving.current = "discard";
      event.currentTarget.blur();
    }
  }

  return (
    <Combobox.Root<PathSuggestion>
      items={groups}
      value={null}
      inputValue={shown}
      onInputValueChange={(next, details) => {
        if (details.reason !== "input-change") return;
        setDraft({ text: next, over: value });
        setOpen(true);
      }}
      onValueChange={(suggestion, details) =>
        pick(suggestion, details.event instanceof KeyboardEvent)
      }
      onItemHighlighted={(suggestion) => {
        highlighted.current = suggestion;
      }}
      open={listed}
      onOpenChange={setOpen}
      filter={() => true}
      autoHighlight={autoHighlight}
      itemToStringLabel={(suggestion) => suggestion.path}
      itemToStringValue={(suggestion) => suggestion.path}
    >
      <Combobox.Input
        ref={input}
        placeholder={implicit ? (placeholder ?? value) : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        data-ui="PathInput"
        data-draft={(draft !== null && (draft.text !== value || implicit)) || undefined}
        className={twMerge(
          "h-[var(--readout-height,auto)] w-auto min-w-0 flex-1 rounded-sm bg-surface-veil-soft px-[var(--readout-padding-x,0.375rem)] py-0.5",
          "font-mono text-[length:inherit] text-surface-200 tabular-nums select-text focus:ring-0 focus:outline-none",
          /* DS-VEIL, DS-HOVER, DS-RADIUS */
          "border-surface-veil hover:border-accent-hover focus:border-accent-500",
          invalid && "border-danger",
          implicit &&
            draft === null &&
            "border-dashed bg-transparent placeholder:text-surface-400 focus:border-solid",
        )}
        onFocus={(event) => {
          if (autoFocus) event.currentTarget.select();
          setOpen(true);
        }}
        onClick={stopRowClick}
        onKeyDown={keys}
        onBlur={leave}
      />
      <Combobox.Portal>
        <Combobox.Positioner side="bottom" align="start" sideOffset={2}>
          <Combobox.Popup
            data-ui="PathInput:list"
            className="max-h-80 w-[max(var(--anchor-width),32rem)] max-w-[40rem] py-0.5"
            onMouseDown={keepFocus}
          >
            <Combobox.List>
              {(group: PathGroup) => (
                <Combobox.Group key={group.value} items={group.items}>
                  <Combobox.GroupLabel className="px-2 pt-1.5 pb-0.5 text-xs font-medium tracking-wide text-surface-400 uppercase select-none">
                    {groupLabel(group.value)}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(suggestion: PathSuggestion) => (
                      <Combobox.Item
                        key={`${suggestion.source.kind}:${suggestion.path}`}
                        value={suggestion}
                        className="px-2 py-1 font-mono text-mono-row"
                      >
                        <SuggestionRow suggestion={suggestion} />
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
            {more > 0 && (
              <div className="px-2 py-1 text-meta text-surface-400 select-none">
                {m.workshop_bin_path_more_hint({ count: more })}
              </div>
            )}
            {searching && groups.length === 0 && (
              <div className="px-2 py-1 text-meta text-surface-400 select-none">
                {m.workshop_bin_path_searching_label()}
              </div>
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** Whether `suggestion` is in the current groups. A stale highlight can point to a removed row. */
function isListed(groups: readonly PathGroup[], suggestion: PathSuggestion | undefined): boolean {
  return suggestion !== undefined && groups.some((group) => group.items.includes(suggestion));
}

function groupLabel(group: PathGroupId): string {
  switch (group) {
    case "project":
      return m.workshop_bin_path_project_label();
    case "folder":
      return m.workshop_bin_path_folder_label();
    case "game":
      return m.workshop_bin_path_game_label();
  }
}

/** One suggestion row: kind icon, file name, dimmed folder, and the layer or archive. */
function SuggestionRow({ suggestion }: { suggestion: PathSuggestion }) {
  const project = useOptionalProjectContext();
  const { folder, file } = splitPath(suggestion.path);
  const kind = describeFileKind(fileKindFromPath(suggestion.path));
  const KindIcon = kind.icon;
  const { source } = suggestion;

  let side = source.kind === "game" ? archiveName(source.wad) : source.layer;
  if (source.kind === "layer" && project !== null) side = layerTitle(project, source.layer);

  return (
    <span className="flex w-full min-w-0 items-center gap-2">
      <span className="flex shrink-0" style={{ color: `var(${kind.tintToken})` }}>
        <KindIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <span className="shrink-0 font-medium text-surface-100">{file}</span>
      <CutText text={folder} className="text-surface-400" />
      {suggestion.current && (
        <span className="shrink-0 text-meta text-accent-400">
          {m.workshop_bin_path_current_label()}
        </span>
      )}
      <span className="flex max-w-40 shrink-0 items-center gap-1 text-meta text-surface-400">
        {/* DS-KIND-HUE */}
        {source.kind === "layer" && <LayerIcon className="h-3 w-3 shrink-0 text-doc-layer-text" />}
        {source.kind === "game" && <ArchiveIcon className="h-3 w-3 shrink-0" />}
        <span className="min-w-0 truncate">{side}</span>
      </span>
    </span>
  );
}

/** An archive's file name without the folder and the `.wad.client` suffix. */
function archiveName(wad: string): string {
  return wad.slice(wad.lastIndexOf("/") + 1).replace(/\.wad\.client$/i, "");
}

/* Stop the click here, so the row's click handler does not run. */
function stopRowClick(event: ReactMouseEvent<HTMLInputElement>) {
  event.stopPropagation();
}

/* A press on the list's scrollbar or a group label would blur the field and commit the
   search terms as a path. */
function keepFocus(event: ReactMouseEvent<HTMLDivElement>) {
  event.preventDefault();
}
