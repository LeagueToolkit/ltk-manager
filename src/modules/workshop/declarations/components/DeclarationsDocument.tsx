import { PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Code, EmptyState, SegmentedControl, Spinner } from "@/components";
import { m } from "@/i18n";
import type { DeclarationsLayer, LineSpan } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps, TextBuffer } from "@/modules/editor";
import { twMerge } from "@/utils";

import type { ContentDocumentOf } from "../../documents/utils/contentDocument";
import type { OpenIntent } from "../../palette/utils/types";
import { useProjectContext } from "../../projects/state/ProjectContext";
import { declarationQueries } from "../api/queries";
import { useGoToDeclaredRow } from "../hooks/useGoToDeclaredRow";
import { useOutlineActions } from "../hooks/useOutlineActions";
import {
  useOutlineRevealRequest,
  useRevealOutlineItem,
  useSettleOutlineReveal,
} from "../state/outlineReveal";
import { selectionOf } from "../utils/lineSpan";
import {
  isInGame,
  itemSpan,
  moduleItemId,
  moduleTally,
  type OutlineNode,
  type OutlineShape,
} from "../utils/outlineTree";
import { DeclarationsTree } from "./DeclarationsTree";

type View = "outline" | "raw";

const DOCUMENT_SHAPE: OutlineShape = { layers: false, keys: true, adds: true };

/**
 * One layer's `game_data` manifest, as an outline of what it declares or as its text.
 *
 * Per "Game data" in docs/ux/PROJECT_EDITOR.md.
 */
export function DeclarationsDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"declarations">>) {
  const project = useProjectContext();
  const outline = useQuery(declarationQueries.outline(project.path));
  const layer = outline.data?.find((held) => held.layer === document.layerName) ?? null;

  const [chosen, setChosen] = useState<View | null>(null);
  const view: View = chosen ?? (layer?.error ? "raw" : "outline");
  const [selected, setSelected] = useState<OutlineNode | null>(null);

  const request = useOutlineRevealRequest(document.id);
  useEffect(() => {
    if (request) setChosen("outline");
  }, [request]);

  return (
    <div
      data-ui="DeclarationsDocument"
      className="@container flex min-h-0 flex-1 flex-col bg-surface-950"
    >
      <DocumentToolbar active={active}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {layer?.file && <Code className="shrink-0">{layer.file}</Code>}
          {layer !== null && layer.modules.length > 0 && <LayerTally layer={layer} />}
        </div>
        <SegmentedControl
          size="xs"
          aria-label={m.workshop_declarations_view_label()}
          value={view}
          onChange={setChosen}
          options={[
            { value: "outline", label: m.workshop_declarations_outline_action() },
            { value: "raw", label: m.workshop_declarations_raw_action() },
          ]}
        />
      </DocumentToolbar>

      <Body
        documentId={document.id}
        layerName={document.layerName}
        layer={layer}
        isLoading={outline.isLoading}
        view={view}
        selected={selected}
        onSelect={setSelected}
        onShowInText={(node) => {
          setSelected(node);
          setChosen("raw");
        }}
      />
    </div>
  );
}

/** What the layer's manifest declares, over every module. */
function LayerTally({ layer }: { layer: DeclarationsLayer }) {
  const keys = layer.modules.reduce((total, module) => total + moduleTally(module).keys, 0);

  return (
    <span className="min-w-0 truncate text-meta text-surface-400 select-none">
      {m.workshop_declarations_modules_label({ count: layer.modules.length })}
      {" · "}
      {m.workshop_declarations_keys_label({ count: keys })}
    </span>
  );
}

interface BodyProps {
  documentId: string;
  layerName: string;
  layer: DeclarationsLayer | null;
  isLoading: boolean;
  view: View;
  selected: OutlineNode | null;
  onSelect: (node: OutlineNode | null) => void;
  onShowInText: (node: OutlineNode) => void;
}

function Body({
  documentId,
  layerName,
  layer,
  isLoading,
  view,
  selected,
  onSelect,
  onShowInText,
}: BodyProps) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (layer?.text == null) {
    return (
      <EmptyState
        size="sm"
        title={m.workshop_declarations_empty_title()}
        description={m.workshop_declarations_empty_description()}
        action={<NewModuleButton documentId={documentId} layerName={layerName} />}
      />
    );
  }

  const error = layer.error;
  const span = error?.span ?? (selected ? itemSpan(selected) : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view === "outline" && (
        <OutlineView
          documentId={documentId}
          layer={layer}
          onSelect={onSelect}
          onShowInText={onShowInText}
        />
      )}
      {view === "raw" && <RawText text={layer.text} span={span} errorLine={error?.span?.line} />}
      {error && (
        <p className="shrink-0 border-t border-danger/40 px-3 py-1.5 text-meta text-danger-text select-text">
          {error.message}
        </p>
      )}
    </div>
  );
}

function OutlineView({
  documentId,
  layer,
  onSelect,
  onShowInText,
}: {
  documentId: string;
  layer: DeclarationsLayer;
  onSelect: (node: OutlineNode | null) => void;
  onShowInText: (node: OutlineNode) => void;
}) {
  const goTo = useGoToDeclaredRow();
  const actions = useOutlineActions();
  const request = useOutlineRevealRequest(documentId);
  const settle = useSettleOutlineReveal();
  const layers = useMemo(() => [layer], [layer]);

  const open = useCallback(
    (node: OutlineNode, intent: OpenIntent) => {
      if (node.type !== "key" && node.type !== "entry") return;
      if (!isInGame(node.entry)) return;

      const key = node.type === "key" ? node.key : null;
      goTo({ module: node.module, entry: node.entry, key }, intent);
    },
    [goTo],
  );

  return (
    <DeclarationsTree
      layers={layers}
      shape={DOCUMENT_SHAPE}
      ariaLabel={m.workshop_declarations_outline_label()}
      onOpen={open}
      openBranches={false}
      actions={actions}
      onShowInText={onShowInText}
      reveal={request}
      onRevealed={settle}
      onSelect={onSelect}
    />
  );
}

interface RawTextProps {
  text: string;
  /** The range to select once the text draws. */
  span: LineSpan | null;
  /** The line a load error names, marked in the gutter. */
  errorLine: number | undefined;
}

/** The manifest's text, read-only, with its line numbers. */
function RawText({ text, span, errorLine }: RawTextProps) {
  const lines = useMemo(() => text.split("\n").length, [text]);
  const gutter = useRef<HTMLDivElement>(null);
  const buffer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const area = buffer.current;
    if (!span || !area) return;

    const [from, to] = selectionOf(text, span);
    area.focus();
    area.setSelectionRange(from, to);
  }, [text, span]);

  return (
    /* DS-MONO-SIZE: mono end to end, so the tier is on the surface. */
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-950 font-mono text-mono-row">
      <div
        ref={gutter}
        aria-hidden
        className="shrink-0 overflow-hidden bg-surface-900/40 py-2 pr-2 pl-3 text-right leading-relaxed text-surface-500 select-none"
      >
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={twMerge(errorLine === index + 1 && "font-medium text-danger-text")}
          >
            {index + 1}
          </div>
        ))}
      </div>

      <TextBuffer
        value={text}
        onChange={() => undefined}
        readOnly
        ariaLabel={m.workshop_declarations_raw_label()}
        spellCheck={false}
        bufferRef={buffer}
        onScroll={(scrollTop) => {
          if (gutter.current) gutter.current.scrollTop = scrollTop;
        }}
        wrapperClassName="bg-transparent"
        className="py-2 pr-2 pl-2 leading-relaxed"
      />
    </div>
  );
}

/** Start the layer's manifest with a module, whose name is typed once the outline shows it. */
function NewModuleButton({ documentId, layerName }: { documentId: string; layerName: string }) {
  const actions = useOutlineActions();
  const reveal = useRevealOutlineItem();

  return (
    <Button
      size="sm"
      variant="outline"
      left={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
      onClick={() => {
        void actions.create(layerName).then((landing) => {
          if (landing !== null) reveal(documentId, moduleItemId(layerName, landing.index), true);
        });
      }}
    >
      {m.workshop_declarations_new_module_action()}
    </Button>
  );
}
