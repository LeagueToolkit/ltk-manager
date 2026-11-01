import { LockSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Menu } from "@/components";
import { m } from "@/i18n";
import type { BinDocumentHandle, DeclaredState } from "@/lib/tauri";

import { layerTitle } from "../../../documents/utils/contentDocument";
import { LayerGlyph } from "../../../layers/components/LayerGlyph";
import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { useHiddenMarkLayers, useSelectLayer, useSetMarkLayerShown } from "../../../state";
import { useLayerRowCounts } from "../hooks/useOverrides";
import { choiceLabel } from "../utils/declaredModule";
import { DeclaredModuleList } from "./DeclaredModuleList";
import { SandboxCheckboxItem, SandboxRadioItem } from "./SandboxRadioItem";

/**
 * A declared document's choices, each one row naming its current value whose list opens
 * beside it: the layer edits write to, the module their new keys join, and which layers mark
 * their rows. The layer and the marks are left out for a project of one layer, and the write
 * choices are disabled while the document takes no edit.
 */
export function DeclaredChoices({
  handle,
  declared,
}: {
  handle: BinDocumentHandle;
  declared: DeclaredState;
}) {
  const project = useOptionalProjectContext();
  const selectLayer = useSelectLayer();
  const locked = handle.readOnly !== null;
  const layered = declared.layers.length > 1;
  const title = (layer: string) => (project === null ? layer : layerTitle(project, layer));

  return (
    <>
      <Menu.Separator />
      {handle.readOnly === "declarationsOff" && (
        <span className="flex items-center gap-1.5 px-2 py-1 text-meta text-surface-400">
          <LockSimpleIcon className="size-3.5 shrink-0" />
          {m.workshop_bin_declarations_off_title()}
        </span>
      )}
      {layered && (
        <ChoiceSubmenu
          label={m.workshop_bin_declares_into_label()}
          value={title(declared.layer)}
          /* DS-KIND-HUE */
          glyph={<LayerGlyph layerName={declared.layer} />}
          disabled={locked}
        >
          <Menu.RadioGroup
            value={declared.layer}
            onValueChange={(layer: string) => selectLayer(layer)}
          >
            {declared.layers.map((layer) => (
              <SandboxRadioItem
                key={layer}
                value={layer}
                closeOnClick
                /* DS-KIND-HUE */
                icon={<LayerGlyph layerName={layer} />}
              >
                {title(layer)}
              </SandboxRadioItem>
            ))}
          </Menu.RadioGroup>
        </ChoiceSubmenu>
      )}
      <ChoiceSubmenu
        label={m.workshop_bin_sandbox_module_label()}
        value={choiceLabel(declared.module, declared.modules)}
        disabled={locked}
      >
        <Menu.Group>
          <Menu.GroupLabel>
            {m.workshop_bin_declares_module_label({ layer: title(declared.layer) })}
          </Menu.GroupLabel>
          <DeclaredModuleList document={handle.document} declared={declared} locked={locked} />
        </Menu.Group>
      </ChoiceSubmenu>
      {layered && <LayerMarkChoices document={handle.document} declared={declared} title={title} />}
    </>
  );
}

/**
 * Which layers mark the rows their declarations touch, each with how many rows that is. The
 * target layer always marks its own.
 */
function LayerMarkChoices({
  document,
  declared,
  title,
}: {
  document: BinDocumentHandle["document"];
  declared: DeclaredState;
  title: (layer: string) => string;
}) {
  const project = useOptionalProjectContext();
  const hidden = useHiddenMarkLayers(project?.path);
  const setShown = useSetMarkLayerShown();
  const counts = useLayerRowCounts(document);
  const marks = (layer: string) => layer === declared.layer || !hidden.includes(layer);

  function note(layer: string): string {
    if (layer === declared.layer) return m.workshop_bin_layer_target_hint();

    const count = counts.get(layer) ?? 0;
    if (count === 0) return m.workshop_bin_layer_changes_empty();
    return m.workshop_bin_layer_changes_label({ count });
  }

  return (
    <ChoiceSubmenu
      label={m.workshop_bin_sandbox_marks_label()}
      value={m.workshop_bin_sandbox_marks_count_label({
        shown: declared.layers.filter(marks).length,
        total: declared.layers.length,
      })}
    >
      {declared.layers.map((layer) => (
        <SandboxCheckboxItem
          key={layer}
          checked={marks(layer)}
          disabled={layer === declared.layer}
          onCheckedChange={(shown: boolean) => setShown(layer, shown)}
          /* DS-KIND-HUE */
          icon={<LayerGlyph layerName={layer} />}
          note={note(layer)}
        >
          {title(layer)}
        </SandboxCheckboxItem>
      ))}
    </ChoiceSubmenu>
  );
}

interface ChoiceSubmenuProps {
  label: string;
  /** The current value, drawn after the label. */
  value: string;
  glyph?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

/** A row of the Sandbox options naming a choice and its value, whose list opens beside it. */
export function ChoiceSubmenu({ label, value, glyph, disabled, children }: ChoiceSubmenuProps) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        disabled={disabled}
        aria-label={m.workshop_bin_sandbox_choice_label({ label, value })}
      >
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="shrink-0">{label}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-surface-400">
            {glyph}
            <span className="truncate">{value}</span>
          </span>
        </span>
      </Menu.SubmenuTrigger>
      <Menu.SubmenuContent className="max-h-[28rem] w-64 overflow-y-auto scrollbar-md">
        {children}
      </Menu.SubmenuContent>
    </Menu.SubmenuRoot>
  );
}
