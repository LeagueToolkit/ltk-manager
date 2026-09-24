import { CaretDownIcon, LockSimpleIcon } from "@phosphor-icons/react";

import { Button, Code, Menu, SeverityGlyph, Tooltip } from "@/components";
import { m, readOnlyDescription } from "@/i18n";
import type {
  BinDocumentId,
  DeclaredDiagnostic,
  DeclaredMark,
  DeclaredState,
  LinkChange,
  ObjectChange,
  ReadOnly,
} from "@/lib/tauri";

import { layerTitle } from "../../../documents/utils/contentDocument";
import { LayerGlyph } from "../../../layers/components/LayerGlyph";
import { useProjectContext } from "../../../projects/state/ProjectContext";
import {
  useSelectedLayerName,
  useSelectedModule,
  useSelectLayer,
  useSetUseDeclarations,
} from "../../../state";
import { useDeclareInto, useDeclaredMark, useRowDiagnostics } from "../hooks/useDeclared";
import { diagnosticSeverity, diagnosticText } from "../utils/declaredDiagnostics";
import { moduleLabel } from "../utils/declaredModule";
import { DeclaredModuleChip } from "./DeclaredModuleChip";

interface DeclaredLayerChipProps {
  document: BinDocumentId;
  declared: DeclaredState;
  /** The gate the document stands behind, `declarationsOff` or null. */
  readOnly: ReadOnly | null;
}

/**
 * The layer a declared document's edits write to, and the menu that switches it and turns
 * the project's declarations on and off. The layer is the project's selected layer, so it
 * holds across tabs and sessions. "Declaring from a game bin" in docs/ux/BIN_EDITOR.md.
 */
export function DeclaredLayerChip({ document, declared, readOnly }: DeclaredLayerChipProps) {
  const project = useProjectContext();
  const selectLayer = useSelectLayer();
  const setUseDeclarations = useSetUseDeclarations();
  useDeclareInto(document, declared, useSelectedLayerName(), useSelectedModule());

  const hint =
    readOnly === null ? m.workshop_bin_declares_into_hint() : readOnlyDescription(readOnly);

  return (
    <span className="flex shrink-0 items-center gap-1">
      <DeclaredDiagnosticsMark
        diagnostics={declared.diagnostics.filter((diagnostic) => diagnostic.entry.length === 0)}
      />
      <Menu.Root>
        <Tooltip content={hint}>
          <Menu.Trigger
            render={
              <Button
                variant="ghost"
                size="xs"
                compact
                aria-label={m.workshop_bin_declares_into_label()}
                left={<ChipGlyph layer={declared.layer} locked={readOnly !== null} />}
                right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
              >
                {layerTitle(project, declared.layer)}
              </Button>
            }
          />
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner align="end">
            <Menu.Popup
              data-ui="DeclaredLayerMenu"
              className="max-h-96 w-56 overflow-y-auto scrollbar-md"
            >
              <Menu.CheckboxItem checked={readOnly === null} onCheckedChange={setUseDeclarations}>
                {m.workshop_bin_declarations_toggle_label()}
              </Menu.CheckboxItem>
              <Menu.Separator />
              <Menu.RadioGroup
                value={declared.layer}
                onValueChange={(layer) => selectLayer(layer as string)}
              >
                {declared.layers.map((layer) => (
                  <Menu.RadioItem key={layer} value={layer}>
                    {layerTitle(project, layer)}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <span aria-hidden="true" className="text-surface-500 select-none">
        /
      </span>
      <DeclaredModuleChip document={document} declared={declared} readOnly={readOnly} />
    </span>
  );
}

/** The chosen layer's glyph, or a lock while declarations are off. */
function ChipGlyph({ layer, locked }: { layer: string; locked: boolean }) {
  if (locked) return <LockSimpleIcon className="h-3.5 w-3.5" />;

  return <LayerGlyph layerName={layer} />;
}

interface DeclaredDiagnosticsMarkProps {
  diagnostics: readonly DeclaredDiagnostic[];
}

/**
 * What the last apply reported about one row, or about nothing the tree draws: the worst
 * of them as a glyph, and each with its key and its layer on hover.
 */
export function DeclaredDiagnosticsMark({ diagnostics }: DeclaredDiagnosticsMarkProps) {
  const project = useProjectContext();
  if (diagnostics.length === 0) return null;
  const severity = diagnostics.some((one) => diagnosticSeverity(one) === "warning")
    ? "warning"
    : "info";

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-1.5">
          {diagnostics.map((diagnostic) => (
            <span key={`${diagnostic.layer}:${diagnostic.key}`} className="flex flex-col gap-0.5">
              <span>{diagnosticText(diagnostic)}</span>
              <span className="flex items-baseline gap-1.5 text-surface-400">
                <Code>{diagnostic.key}</Code>
                {layerTitle(project, diagnostic.layer)}
              </span>
              {diagnostic.detail !== null && <span>{diagnostic.detail}</span>}
            </span>
          ))}
        </span>
      }
    >
      <span
        role="img"
        aria-label={m.workshop_bin_declared_diagnostics_label({ count: diagnostics.length })}
        className="flex shrink-0"
      >
        <SeverityGlyph severity={severity} />
      </span>
    </Tooltip>
  );
}

interface DeclaredRowMarkProps {
  mark: DeclaredMark;
  /** The layer the mark's declaration is in. */
  layer: string;
}

/** A field's declaration marker and apply diagnostics. */
export function DeclaredRowState({ rowKey }: { rowKey: string }) {
  const declared = useDeclaredMark(rowKey);
  const diagnostics = useRowDiagnostics(rowKey);

  return (
    <>
      {declared !== null && <DeclaredRowMark mark={declared.mark} layer={declared.layer} />}
      <DeclaredDiagnosticsMark diagnostics={diagnostics} />
    </>
  );
}

/**
 * The mark on an object row the chosen layer creates or removes: the layer's glyph for a
 * creation, and a `removed` tag for a removal. ADR-0049.
 */
export function ObjectChangeMark({ change, layer }: { change: ObjectChange; layer: string }) {
  const title = layerTitle(useProjectContext(), layer);
  if (change === "created") {
    return (
      <ChangeMark layer={layer} label={m.workshop_bin_object_created_label({ layer: title })} />
    );
  }
  return (
    <ChangeMark
      removed
      layer={layer}
      label={m.workshop_bin_object_removed_label({ layer: title })}
    />
  );
}

/** The mark on a dependency row the chosen layer adds or removes, drawn as an object's. ADR-0050. */
export function LinkChangeMark({ change, layer }: { change: LinkChange; layer: string }) {
  const title = layerTitle(useProjectContext(), layer);
  if (change === "added") {
    return (
      <ChangeMark layer={layer} label={m.workshop_bin_dependency_added_label({ layer: title })} />
    );
  }
  return (
    <ChangeMark
      removed
      layer={layer}
      label={m.workshop_bin_dependency_removed_label({ layer: title })}
    />
  );
}

interface ChangeMarkProps {
  layer: string;
  label: string;
  /** A removal, which carries a `removed` tag after the glyph. */
  removed?: boolean;
}

function ChangeMark({ layer, label, removed = false }: ChangeMarkProps) {
  if (!removed) {
    return (
      <Tooltip content={label}>
        <span role="img" aria-label={label} className="flex shrink-0">
          {/* DS-KIND-HUE */}
          <LayerGlyph layerName={layer} className="h-3 w-3" />
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={label}>
      <span
        aria-label={label}
        className="flex shrink-0 items-center gap-1 text-meta text-surface-400 select-none"
      >
        {/* DS-KIND-HUE */}
        <LayerGlyph layerName={layer} className="h-3 w-3" />
        {m.workshop_bin_object_removed_tag()}
      </span>
    </Tooltip>
  );
}

/** The mark on a row a declaration of the chosen layer touches, with the game's value on hover. */
export function DeclaredRowMark({ mark, layer }: DeclaredRowMarkProps) {
  const project = useProjectContext();
  const label = m.workshop_bin_declared_row_label({ layer: layerTitle(project, layer) });

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-1">
          <span>{label}</span>
          <span className="flex items-baseline gap-1.5">
            {m.workshop_bin_declared_module_label()}
            <span className="text-surface-100">
              {moduleLabel({ index: mark.module, name: mark.moduleName })}
            </span>
          </span>
          {mark.whole && <span>{m.workshop_bin_declared_whole_hint()}</span>}
          {mark.reference !== null && (
            <span className="flex items-baseline gap-1.5">
              {m.workshop_bin_declared_reference_label()}
              <Code>{mark.reference}</Code>
            </span>
          )}
          {mark.game !== null && (
            <span className="flex items-baseline gap-1.5">
              {m.workshop_bin_declared_game_value_label()}
              <Code>{mark.game}</Code>
            </span>
          )}
        </span>
      }
    >
      <span role="img" aria-label={label} className="flex shrink-0">
        {/* DS-KIND-HUE */}
        <LayerGlyph layerName={layer} className="h-3 w-3" />
      </span>
    </Tooltip>
  );
}
