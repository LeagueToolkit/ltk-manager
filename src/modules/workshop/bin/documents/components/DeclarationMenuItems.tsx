import {
  ArrowsLeftRightIcon,
  ArrowsMergeIcon,
  ClipboardTextIcon,
  CodeBlockIcon,
  LinkSimpleIcon,
} from "@phosphor-icons/react";
import { use } from "react";

import { ContextMenu, Menu, useToast } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { errorSummary, m } from "@/i18n";
import { api, type BinDocumentId, type BinRow, type DeclaredMark } from "@/lib/tauri";

import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { RowDocumentContext } from "../../tree/state/rowFold";
import { rowKey } from "../../tree/utils/binRows";
import {
  useCopyDeclaration,
  useDeclaredMark,
  useDeclaredState,
  useDeclaresEdits,
  useModuleAction,
  useRowDeclaration,
} from "../hooks/useDeclared";
import { useDocumentCall } from "../hooks/useDocumentCall";
import { useCopiedReference, useRememberReference } from "../state/copiedReference";
import { moduleLabel } from "../utils/declaredModule";

/**
 * A row's declaration and reference actions: Copy as declaration and Copy reference on any
 * bin, and Paste reference, Move to module and Merge reference on a declared document that
 * takes edits. "Declaring from a game bin" in docs/ux/BIN_EDITOR.md.
 */
export function DeclarationMenuItems({ row }: { row: BinRow }) {
  const document = use(RowDocumentContext);
  const declares = useDeclaresEdits();
  const copy = useCopyToClipboard();
  const remember = useRememberReference();
  const copied = useCopiedReference();
  const invalidate = useInvalidateBinReads();
  const call = useDocumentCall(document);
  const toast = useToast();

  const spelled = useRowDeclaration(document, row.entry, row.path);
  const copyDeclaration = useCopyDeclaration();

  if (document === null || row.node === "record" || row.node === "target") return null;
  /* An object copies as its entry. A reference and a paste name a value, which it is not. */
  const object = row.node === "object";
  const declaration = spelled?.declaration ?? null;
  const reference = spelled?.reference ?? null;
  const merges = row.value.type === "container" || row.value.type === "map";

  function declare(merge: boolean) {
    if (document === null || copied === null) return;
    const declared = call((id) =>
      api.bin.edit(id, {
        kind: "declareReference",
        entry: row.entry,
        path: row.path,
        reference: copied,
        merge,
      }),
    );
    void declared.then(({ result }) => {
      if (!result.ok) {
        toast.error(m.workshop_bin_reference_failed_title(), errorSummary(result.error));
        return;
      }
      invalidate();
    });
  }

  return (
    <>
      <ContextMenu.Item
        icon={<CodeBlockIcon />}
        disabled={declaration === null}
        title={declaration === null ? m.workshop_bin_copy_declaration_refused_hint() : undefined}
        onClick={() => spelled !== null && copyDeclaration(spelled)}
      >
        {m.workshop_bin_copy_declaration_action()}
      </ContextMenu.Item>
      {!object && (
        <ContextMenu.Item
          icon={<LinkSimpleIcon />}
          disabled={reference === null}
          title={reference === null ? m.workshop_bin_copy_reference_refused_hint() : undefined}
          onClick={() => {
            if (reference === null) return;
            remember(reference);
            void copy(`!ref ${reference}`, m.workshop_bin_reference_label());
          }}
        >
          {m.workshop_bin_copy_reference_action()}
        </ContextMenu.Item>
      )}
      {declares && !object && (
        <ContextMenu.Item
          icon={<ClipboardTextIcon />}
          disabled={copied === null}
          title={copied ?? m.workshop_bin_paste_reference_empty_hint()}
          onClick={() => declare(false)}
        >
          {m.workshop_bin_paste_reference_action()}
        </ContextMenu.Item>
      )}
      {declares && !object && <MoveToModuleSubmenu row={row} />}
      {declares && !object && merges && (
        <ContextMenu.Item
          icon={<ArrowsMergeIcon />}
          disabled={copied === null}
          title={copied ?? m.workshop_bin_paste_reference_empty_hint()}
          onClick={() => declare(true)}
        >
          {m.workshop_bin_merge_reference_action()}
        </ContextMenu.Item>
      )}
      <ContextMenu.Separator />
    </>
  );
}

/**
 * Move the row's declaration to another module of its layer: every signed key of its path.
 * Drawn only on a row a declaration of the chosen layer touches. ADR-0048.
 */
function MoveToModuleSubmenu({ row }: { row: BinRow }) {
  const document = use(RowDocumentContext);
  const declared = useDeclaredMark(rowKey(row));
  if (document === null || declared === null) return null;

  return <MoveToModule document={document} mark={declared.mark} layer={declared.layer} />;
}

interface MoveToModuleProps {
  document: BinDocumentId;
  mark: DeclaredMark;
  layer: string;
}

function MoveToModule({ document, mark, layer }: MoveToModuleProps) {
  const state = useDeclaredState(document);
  const act = useModuleAction(document);
  const targets = (state?.modules ?? []).filter(
    (module) => module.takesKeys && module.index !== mark.module,
  );

  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        icon={<ArrowsLeftRightIcon />}
        disabled={targets.length === 0}
        title={targets.length === 0 ? m.workshop_bin_move_to_module_empty() : undefined}
      >
        {m.workshop_bin_move_to_module_action()}
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.SubmenuPositioner>
          <Menu.Popup data-ui="DeclarationMenuItems:move-to-module">
            {targets.map((module) => (
              <Menu.Item
                key={module.index}
                onClick={() =>
                  void act(layer, {
                    kind: "moveKeys",
                    module: mark.module,
                    entry: mark.entry,
                    path: mark.property,
                    to: module.index,
                  })
                }
              >
                {moduleLabel(module)}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.SubmenuPositioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}
